/**
 * Verifies "Update live price list": a reviewed change reaches the version that is
 * already live, and therefore the projects pinned to it, without creating a new version
 * and without moving a price already saved on a quotation.
 *
 * The two things worth proving are opposites, so both are asserted here: a project
 * created long before the update CAN see the new item, and a line item saved on that
 * project CANNOT have moved.
 *
 * Development database only. Cleans up after itself by putting the Draft back and
 * applying it a second time.
 */
import { db } from "../server/db";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { sql, eq, and } from "drizzle-orm";
import { catalogItems, pricingVersions, projects, lineItems, rooms, users } from "@shared/schema";

const BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
const USER = "pv-ui-test";
const TEST_CODE = "ZTEST-9001";
// Generated per run and written into the dev database just before logging in, so no
// working credential lives in source control.
const PASS = `pv-${randomBytes(18).toString("base64url")}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

/** Gives the dev-only test account a fresh throwaway password for this run. */
async function provisionTestUser(): Promise<void> {
  const hash = await bcrypt.hash(PASS, 10);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, USER)).limit(1);
  if (existing) {
    await db.update(users).set({ password: hash, role: "admin", status: "active" }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ username: USER, password: hash, role: "admin", status: "active" } as any);
  }
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
  console.log("UPDATE-LIVE TESTS");
  console.log("=".repeat(78));

  await provisionTestUser();
  const cookie = await login();

  const [active] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "active")).limit(1);
  const [draft] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "draft")).limit(1);
  if (!active || !draft) throw new Error("Dev database has no active/draft version.");

  const versionsBefore = await db.select({ id: pricingVersions.id }).from(pricingVersions);
  const [{ n: liveCountBefore }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, active.id));
  console.log(`\nLive: ${active.name} (V${active.versionNumber})   Draft: ${draft.name}\n`);

  // A project that already exists on the live version, plus one of its saved lines.
  let [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.pricingVersionId, active.id))
    .limit(1);
  let temporaryProjectId: string | null = null;
  if (!project) {
    // Dev may have no project on the live version. Stand one up with a saved line so the
    // "already quoted prices do not move" assertion still has something to check.
    const [me] = await db.select({ id: users.id }).from(users).where(eq(users.username, USER)).limit(1);
    const [created] = await db
      .insert(projects)
      .values({
        userId: me.id,
        clientName: "TEMP update-live verification",
        projectType: "Residential",
        defaultCategory: "DeX - Xpress",
        pricingVersionId: active.id,
      } as any)
      .returning();
    const [room] = await db
      .insert(rooms)
      .values({ projectId: created.id, roomName: "Test room", roomType: "Dry / Inexposed" } as any)
      .returning();
    await db.insert(lineItems).values({
      roomId: room.id,
      projectId: created.id,
      description: "TEMP saved line",
      unitType: "Sqft",
      lengthFt: 10, heightFt: 8, sqft: 80, lengthMm: 3048, heightMm: 2438,
      rate: 1000, quantity: 1, amount: 80000,
    } as any);
    project = { id: created.id };
    temporaryProjectId = created.id;
    console.log(`  (created temporary project ${created.id.slice(0, 8)} on the live version)\n`);
  }
  const savedLines = await db
    .select({ id: lineItems.id, rate: lineItems.rate, amount: lineItems.amount })
    .from(lineItems)
    .where(eq(lineItems.projectId, project.id));

  // --- Stage a new item and a price change in the Draft --------------------------
  const [template] = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.pricingVersionId, draft.id), sql`item_code IS NOT NULL`))
    .limit(1);
  const { id: _id, createdAt: _c, updatedAt: _u, ...templateRest } = template as any;
  await db.insert(catalogItems).values({
    ...templateRest,
    itemCode: TEST_CODE,
    description: "TEMP update-live verification item",
    rate: 4321,
    sellingPrice: 4321,
  } as any);

  const [victim] = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.pricingVersionId, draft.id), eq(catalogItems.itemCode, template.itemCode!)))
    .limit(1);
  const originalRate = victim.rate;
  const originalSelling = victim.sellingPrice;
  await db
    .update(catalogItems)
    .set({ rate: (originalRate ?? 0) + 111, sellingPrice: (originalSelling ?? 0) + 111 })
    .where(and(eq(catalogItems.pricingVersionId, draft.id), eq(catalogItems.itemCode, template.itemCode!)));

  const preview = await api(cookie, "GET", "/api/admin/pricing-versions/preview");
  check("preview shows the staged addition", (preview.json?.added || []).some((r: any) => r.itemCode === TEST_CODE));
  check("preview shows the staged price change", (preview.json?.changed || []).some((r: any) => r.itemCode === template.itemCode));

  // --- Apply it to the live version ----------------------------------------------
  const res = await api(cookie, "POST", "/api/admin/pricing-versions/update-live", { notes: "automated verification" });
  check("update-live succeeds", res.status === 200, res.status === 200 ? res.json.message : res.text);

  const versionsAfter = await db.select({ id: pricingVersions.id }).from(pricingVersions);
  check("no new version was created", versionsAfter.length === versionsBefore.length, `${versionsBefore.length} → ${versionsAfter.length}`);

  const [activeAfter] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "active")).limit(1);
  check("the same version is still live", activeAfter.id === active.id);
  check("its number and name are unchanged", activeAfter.versionNumber === active.versionNumber && activeAfter.name === active.name);

  const inLive = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(and(eq(catalogItems.pricingVersionId, active.id), eq(catalogItems.itemCode, TEST_CODE)));
  check("the new item is now in the live version", (inLive[0]?.n ?? 0) > 0);

  // The point of the whole feature: a project created before the update can use it.
  const catalog = await api(cookie, "GET", `/api/catalog?projectId=${project.id}`);
  check(
    "a pre-existing project can see the new item",
    Array.isArray(catalog.json) && catalog.json.some((i: any) => i.description === "TEMP update-live verification item"),
    `project ${project.id.slice(0, 8)}, ${Array.isArray(catalog.json) ? catalog.json.length : "?"} items`
  );

  const linesAfter = await db
    .select({ id: lineItems.id, rate: lineItems.rate, amount: lineItems.amount })
    .from(lineItems)
    .where(eq(lineItems.projectId, project.id));
  const moved = savedLines.filter(l => {
    const now = linesAfter.find(x => x.id === l.id);
    return !now || now.rate !== l.rate || now.amount !== l.amount;
  });
  check("no saved line item moved", moved.length === 0, `${savedLines.length} lines checked`);

  // --- A per-quotation extra keeps the price it was granted at ---------------------
  // An old quotation can be granted a product from the live list. Because the live
  // list's rows can now be rewritten, the granted price has to be pinned on the grant
  // itself, or a later correction would quietly move it on that quotation.
  const [archivedVersion] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "archived")).limit(1);
  let exceptionProjectId: string | null = null;
  if (archivedVersion) {
    const [me] = await db.select({ id: users.id }).from(users).where(eq(users.username, USER)).limit(1);
    const [oldProject] = await db
      .insert(projects)
      .values({
        userId: me.id,
        clientName: "TEMP exception verification",
        projectType: "Residential",
        defaultCategory: "DeX - Xpress",
        pricingVersionId: archivedVersion.id,
      } as any)
      .returning();
    exceptionProjectId = oldProject.id;

    const granted = await api(cookie, "POST", `/api/projects/${oldProject.id}/catalog-exceptions`, { itemCode: TEST_CODE });
    check("an old quotation can be granted the new item", granted.status === 200 || granted.status === 201, granted.text.slice(0, 120));

    const before = await api(cookie, "GET", `/api/catalog?projectId=${oldProject.id}`);
    const grantedItem = (before.json || []).find((i: any) => i.description === "TEMP update-live verification item");
    check("the granted item is priced from the live list", grantedItem?.sellingPrice === 4321, `${grantedItem?.sellingPrice}`);

    // Now correct that item's price on the live list.
    await db
      .update(catalogItems)
      .set({ rate: 9999, sellingPrice: 9999 })
      .where(and(eq(catalogItems.pricingVersionId, draft.id), eq(catalogItems.itemCode, TEST_CODE)));
    const second = await api(cookie, "POST", "/api/admin/pricing-versions/update-live", { notes: "price correction" });
    check("second update-live succeeds", second.status === 200, second.status === 200 ? "" : second.text);

    const after = await api(cookie, "GET", `/api/catalog?projectId=${oldProject.id}`);
    const afterItem = (after.json || []).find((i: any) => i.description === "TEMP update-live verification item");
    check("the granted price did NOT move with the live list", afterItem?.sellingPrice === 4321, `${afterItem?.sellingPrice}`);

    // The project that is actually pinned to the live list should see the correction.
    const liveProjectCatalog = await api(cookie, "GET", `/api/catalog?projectId=${project.id}`);
    const liveItem = (liveProjectCatalog.json || []).find((i: any) => i.description === "TEMP update-live verification item");
    check("a project on the live list does see the correction", liveItem?.sellingPrice === 9999, `${liveItem?.sellingPrice}`);
  }

  const previewAfter = await api(cookie, "GET", "/api/admin/pricing-versions/preview");
  const remaining = (previewAfter.json?.changed?.length ?? 0) + (previewAfter.json?.added?.length ?? 0) + (previewAfter.json?.removed?.length ?? 0);
  check("the Draft now matches Live", remaining === 0, `${remaining} pending`);

  const audit = await api(cookie, "GET", "/api/admin/pricing-versions/audit?limit=5");
  check("the action is recorded as its own kind", (audit.json || []).some((a: any) => a.action === "update_live"));

  // Archived versions must not have been touched.
  const archived = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "archived"));
  for (const v of archived) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(and(eq(catalogItems.pricingVersionId, v.id), eq(catalogItems.itemCode, TEST_CODE)));
    check(`archived ${v.name} is untouched`, n === 0);
  }

  // --- Put everything back ---------------------------------------------------------
  await db.delete(catalogItems).where(and(eq(catalogItems.pricingVersionId, draft.id), eq(catalogItems.itemCode, TEST_CODE)));
  await db
    .update(catalogItems)
    .set({ rate: originalRate, sellingPrice: originalSelling })
    .where(and(eq(catalogItems.pricingVersionId, draft.id), eq(catalogItems.itemCode, template.itemCode!)));
  const restore = await api(cookie, "POST", "/api/admin/pricing-versions/update-live", { notes: "automated verification cleanup" });
  check("cleanup update-live succeeds", restore.status === 200, restore.status === 200 ? restore.json.message : restore.text);

  const leftover = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.itemCode, TEST_CODE));
  check("test item removed everywhere", (leftover[0]?.n ?? 0) === 0);

  if (temporaryProjectId) await db.delete(projects).where(eq(projects.id, temporaryProjectId));
  if (exceptionProjectId) await db.delete(projects).where(eq(projects.id, exceptionProjectId));

  const [finalActive] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "active")).limit(1);
  const [{ n: finalCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, finalActive.id));
  const [{ n: finalDraftCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, draft.id));
  // Not compared with the count before the test: the Draft may legitimately have been
  // carrying unpublished changes already. What must hold is that live and Draft now agree.
  check("live and Draft hold the same number of items", finalCount === finalDraftCount, `${finalCount} vs ${finalDraftCount}`);
  check("the stored item count matches reality", finalActive.itemCount === finalCount, `${finalActive.itemCount} vs ${finalCount}`);
  if (finalCount !== liveCountBefore) {
    console.log(`  NOTE  live went ${liveCountBefore} → ${finalCount}; the Draft already held unpublished changes before this run.`);
  }

  console.log(`\n${"=".repeat(78)}\n${pass} passed, ${fail} failed\n${"=".repeat(78)}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
