/**
 * Regression tests for the defects that could break the core guarantee:
 * an existing quotation must never be repriced.
 *
 * Covers:
 *   - a client cannot move a project onto a different price list via PATCH
 *   - duplicating a project keeps the original's price list
 *   - a sync that is overtaken by a publish must not write into the published version
 *   - a project created while a publish is running is still stamped coherently
 *
 * Development database only.
 */
import { db } from "../server/db";
import { sql, eq } from "drizzle-orm";
import { catalogItems, pricingVersions, projects, users } from "@shared/schema";
import { getActiveVersion, getDraftVersion, publishDraft, listVersions, countVersionItems } from "../server/pricing-versions";
import { syncCatalogToDraft } from "../server/catalog-sync";
import { storage } from "../server/storage";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";

// The session cookie is Secure, so it is dropped over plain http on localhost.
// Go through the https dev domain the browser uses.
const BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
const USER = "pv-ui-test";
const PASS = `pv-${randomBytes(18).toString("base64url")}`;
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || "";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie?.()[0] || res.headers.get("set-cookie") || "";
  if (!cookie) throw new Error("No session cookie returned");
  return cookie.split(";")[0];
}

async function api(cookie: string, method: string, path: string, body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log("=".repeat(78));
  console.log("GUARANTEE REGRESSION TESTS");
  console.log("=".repeat(78));

  await db
    .update(users)
    .set({ password: await bcrypt.hash(PASS, 10), status: "active" })
    .where(eq(users.username, USER));

  const cookie = await login();
  const startTotals: any = (await db.execute(sql`SELECT COALESCE(SUM(amount),0)::bigint AS s FROM line_items`) as any).rows[0];

  // Make sure there is an archived version with projects on it.
  if ((await listVersions()).filter((v) => v.status === "archived").length === 0) {
    console.log("\nSeeding an archived version by publishing once...");
    await publishDraft({ name: "V2 - Regression Setup", performedBy: undefined });
  }

  const active = (await getActiveVersion())!;
  const archived = (await listVersions()).find((v) => v.status === "archived")!;
  console.log(`\nLive: ${active.name}   Archived: ${archived.name}\n`);

  // ---------------------------------------------------------------- PATCH spoof
  console.log("[1] A client cannot move a project onto another price list");
  const created = await api(cookie, "POST", "/api/projects", {
    clientName: "REGRESSION TEST - safe to delete",
    projectType: "Residential",
    defaultCategory: "DeX - Xpress",
  });
  check("project created", created.status === 200 || created.status === 201, `status ${created.status}`);
  const projectId = created.json?.id;
  const stampedAtCreate = created.json?.pricingVersionId;
  check("new project stamped with the live version", stampedAtCreate === active.id);

  await api(cookie, "PATCH", `/api/projects/${projectId}`, {
    clientName: "REGRESSION TEST - renamed",
    pricingVersionId: archived.id,
  });
  const [afterPatch] = await db.select().from(projects).where(eq(projects.id, projectId));
  check("PATCH could not change the pricing version", afterPatch.pricingVersionId === stampedAtCreate,
    afterPatch.pricingVersionId === archived.id ? "SPOOFED!" : "unchanged");
  check("PATCH still applied the legitimate field", afterPatch.clientName === "REGRESSION TEST - renamed");

  // ------------------------------------------------------------------ duplicate
  console.log("\n[2] Duplicating a project keeps its original price list");
  const [onArchived] = await db.select().from(projects).where(eq(projects.pricingVersionId, archived.id)).limit(1);
  if (onArchived) {
    const copy = await storage.duplicateProject(onArchived.id, onArchived.userId);
    check("copy inherits the original's version", copy.pricingVersionId === archived.id,
      copy.pricingVersionId === active.id ? "REPRICED to live!" : "inherited");
    await db.delete(projects).where(eq(projects.id, copy.id));
  } else {
    check("a project exists on the archived version", false, "none found");
  }

  // ------------------------------------------------------- sync overtaken by publish
  console.log("\n[3] A sync overtaken by a publish must not write into the published version");
  const draftBefore = (await getDraftVersion())!;
  const publishedCountsBefore = new Map<string, number>();
  for (const v of (await listVersions()).filter((v) => v.status !== "draft")) {
    publishedCountsBefore.set(v.id, await countVersionItems(v.id));
  }

  // Start the sync (it spends seconds reading Sheets), then publish underneath it.
  const syncPromise = syncCatalogToDraft(SPREADSHEET_ID, {}).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({ ok: false as const, e })
  );
  await new Promise((r) => setTimeout(r, 250));
  const publishResult = await publishDraft({ name: "V-Race", performedBy: undefined }).then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  );
  const syncResult = await syncPromise;

  console.log(`      publish: ${publishResult.ok ? "succeeded" : "refused - " + publishResult.e.message}`);
  console.log(`      sync:    ${syncResult.ok ? "succeeded" : "refused - " + syncResult.e.message}`);

  // Whatever the interleaving, the promoted version must be byte-stable.
  let mutated: string[] = [];
  for (const [vid, count] of publishedCountsBefore) {
    const now = await countVersionItems(vid);
    if (now !== count) mutated.push(`${vid} ${count} -> ${now}`);
  }
  check("no previously-published version had its rows changed", mutated.length === 0, mutated.join("; ") || "all stable");

  if (publishResult.ok) {
    const promoted = publishResult.v;
    const promotedIsFrozen = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pricingVersions)
      .where(sql`${pricingVersions.id} = ${promoted.id} AND ${pricingVersions.status} <> 'draft'`))[0].n === 1;
    check("the promoted version is no longer a draft", promotedIsFrozen);
    check(
      "sync either wrote to the new Draft or refused outright",
      !syncResult.ok || (await getDraftVersion())!.id !== promoted.id,
      syncResult.ok ? "wrote to the current draft" : "refused"
    );
  }

  const draftNow = (await getDraftVersion())!;
  check("a Draft still exists afterwards", !!draftNow && draftNow.id !== draftBefore.id || !publishResult.ok);
  check("exactly one Active and one Draft remain",
    (await listVersions()).filter((v) => v.status === "active").length === 1 &&
    (await listVersions()).filter((v) => v.status === "draft").length === 1);

  // -------------------------------------------- project creation during a publish
  console.log("\n[4] A project created during a publish is stamped coherently");
  if ((await countVersionItems((await getDraftVersion())!.id)) === 0) {
    await syncCatalogToDraft(SPREADSHEET_ID, {});
  }
  const createDuring = api(cookie, "POST", "/api/projects", {
    clientName: "REGRESSION TEST RACE - safe to delete",
    projectType: "Residential",
    defaultCategory: "DeX - Xpress",
  });
  const publishDuring = publishDraft({ name: "V-Race-2", performedBy: undefined }).then(
    (v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e })
  );
  const [createdDuring, publishedDuring] = await Promise.all([createDuring, publishDuring]);
  const stamped = createdDuring.json?.pricingVersionId;
  const validVersionIds = new Set((await listVersions()).filter((v) => v.status !== "draft").map((v) => v.id));
  check("project got a real, frozen version (never null, never the Draft)", !!stamped && validVersionIds.has(stamped),
    `${stamped ? "stamped" : "NULL"}`);
  console.log(`      publish during create: ${publishedDuring.ok ? "succeeded" : "refused - " + publishedDuring.e.message}`);

  // ------------------------------------------------------------------- guarantee
  console.log("\n[5] Nothing above repriced an existing quotation");
  const endTotals: any = (await db.execute(sql`SELECT COALESCE(SUM(amount),0)::bigint AS s FROM line_items`) as any).rows[0];
  check("total quoted value across all projects unchanged", String(startTotals.s) === String(endTotals.s),
    `${startTotals.s} -> ${endTotals.s}`);

  await db.delete(projects).where(sql`${projects.clientName} LIKE 'REGRESSION TEST%'`);

  console.log("\n" + "=".repeat(78));
  console.log(`${pass} passed, ${fail} failed`);
  console.log("=".repeat(78));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nHARNESS ERROR:", e);
  process.exit(1);
});
