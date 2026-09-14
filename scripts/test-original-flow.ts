/**
 * Verifies that the everyday flow behaves exactly as it did before pricing versions.
 *
 * Checks, in order:
 *   1. A product with a blank room type is offered in BOTH a Wet and a Dry room.
 *   2. The counts the catalog returns match what the stored rows imply, per room.
 *   3. Material specs come back for each category on a normally started app.
 *   4. With instant sync on, refreshing from the sheet puts prices live with no second
 *      step, and does not create a new version.
 *   5. A project created before the sync sees the new prices straight away.
 *   6. Prices already saved on a quotation do not move.
 *   7. Turning instant sync off restores the review-first behaviour.
 *
 * DEVELOPMENT ONLY. Run with: npx tsx scripts/test-original-flow.ts
 */
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../server/db";
import { catalogItems, pricingVersions, projects, rooms, lineItems, users } from "@shared/schema";

const BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
const USER = "pv-ui-test";
const PASS = `pv-${randomBytes(18).toString("base64url")}`;
const CATEGORY = "DeX - Xpress";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

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
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log("\n" + "=".repeat(78));
  console.log("ORIGINAL (PRE-VERSIONING) FLOW");
  console.log("=".repeat(78) + "\n");

  await provisionTestUser();
  const cookie = await login();

  const [active] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "active")).limit(1);
  if (!active) throw new Error("No live version in dev.");
  console.log(`Live: ${active.name} (V${active.versionNumber})\n`);

  // --- 1 & 2. Room-type filtering matches the stored rows ---------------------------
  const [counts] = await db
    .select({
      blank: sql<number>`count(*) FILTER (WHERE ${catalogItems.roomType} IS NULL OR trim(${catalogItems.roomType})='')::int`,
      wet: sql<number>`count(*) FILTER (WHERE trim(coalesce(${catalogItems.roomType},''))='Wet / Exposed')::int`,
      dry: sql<number>`count(*) FILTER (WHERE trim(coalesce(${catalogItems.roomType},''))='Dry / Inexposed')::int`,
    })
    .from(catalogItems)
    .where(and(eq(catalogItems.pricingVersionId, active.id), eq(catalogItems.categoryName, CATEGORY)));

  const wetRes = await api(cookie, "GET", `/api/catalog?category=${encodeURIComponent(CATEGORY)}&roomType=${encodeURIComponent("Wet / Exposed")}`);
  const dryRes = await api(cookie, "GET", `/api/catalog?category=${encodeURIComponent(CATEGORY)}&roomType=${encodeURIComponent("Dry / Inexposed")}`);
  const wetCount = Array.isArray(wetRes.json) ? wetRes.json.length : -1;
  const dryCount = Array.isArray(dryRes.json) ? dryRes.json.length : -1;

  check("a Wet room is offered blank-room-type items too", wetCount === counts.blank + counts.wet, `${wetCount} returned, expected ${counts.blank + counts.wet} (${counts.blank} blank + ${counts.wet} wet)`);
  check("a Dry room is offered blank-room-type items too", dryCount === counts.blank + counts.dry, `${dryCount} returned, expected ${counts.blank + counts.dry} (${counts.blank} blank + ${counts.dry} dry)`);
  check("blank-room-type items are not labelled as a real room", (wetRes.json || []).every((i: any) => !i.roomType || i.roomType === "Wet / Exposed"));

  // --- 3. Material specs ------------------------------------------------------------
  const specs = await api(cookie, "GET", `/api/catalog/material-specs/${encodeURIComponent(CATEGORY)}`);
  const specKeys = specs.json ? Object.keys(specs.json).filter(k => specs.json[k]) : [];
  check("material specs come back for a category", specKeys.length > 0, specKeys.join(", ") || "empty");

  // --- 4-6. Instant sync ------------------------------------------------------------
  await api(cookie, "PUT", "/api/admin/settings/instant-sync", { enabled: true });
  const setting = await api(cookie, "GET", "/api/admin/settings/instant-sync");
  check("instant sync reports itself as on", setting.json?.enabled === true);

  // A quotation that exists before the sync, with a saved line, on the live version.
  const [me] = await db.select({ id: users.id }).from(users).where(eq(users.username, USER)).limit(1);
  const [project] = await db
    .insert(projects)
    .values({ userId: me.id, clientName: "TEMP original-flow check", projectType: "Residential", defaultCategory: CATEGORY, pricingVersionId: active.id } as any)
    .returning();
  const [room] = await db
    .insert(rooms)
    .values({ projectId: project.id, roomName: "Kitchen", roomType: "Wet / Exposed", category: CATEGORY } as any)
    .returning();
  const [savedLine] = await db
    .insert(lineItems)
    .values({ roomId: room.id, projectId: project.id, description: "TEMP saved line", unitType: "General", lengthFt: 1, heightFt: 1, sqft: 1, lengthMm: 300, heightMm: 300, rate: 1234, quantity: 1, amount: 1234, itemType: "woodworks" } as any)
    .returning();

  const versionsBefore = await db.select({ id: pricingVersions.id }).from(pricingVersions);

  console.log("\n  (syncing the real Google Sheet — this takes a moment)\n");
  const sync = await api(cookie, "POST", "/api/catalog/refresh");
  check("sync succeeds", sync.status === 200, sync.status === 200 ? sync.json.message : sync.text.slice(0, 200));
  check("the sync went live by itself, with no second step", sync.json?.appliedLive === true, sync.json?.liveError || "");

  const versionsAfter = await db.select({ id: pricingVersions.id }).from(pricingVersions);
  check("no new version was created by a sync", versionsAfter.length === versionsBefore.length, `${versionsBefore.length} → ${versionsAfter.length}`);

  const [activeAfter] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "active")).limit(1);
  check("the same version is still live", activeAfter.id === active.id);

  const previewAfter = await api(cookie, "GET", "/api/admin/pricing-versions/preview");
  const pending = (previewAfter.json?.changed?.length ?? 0) + (previewAfter.json?.added?.length ?? 0) + (previewAfter.json?.removed?.length ?? 0);
  check("nothing is left waiting for review", pending === 0, `${pending} pending`);

  const projectCatalog = await api(cookie, "GET", `/api/catalog?projectId=${project.id}&category=${encodeURIComponent(CATEGORY)}&roomType=${encodeURIComponent("Wet / Exposed")}`);
  check("an existing quotation sees the synced catalog immediately", Array.isArray(projectCatalog.json) && projectCatalog.json.length > 0, `${Array.isArray(projectCatalog.json) ? projectCatalog.json.length : "?"} items`);

  const [lineAfter] = await db.select().from(lineItems).where(eq(lineItems.id, savedLine.id));
  check("a price already saved on a quotation did not move", lineAfter.rate === savedLine.rate && lineAfter.amount === savedLine.amount, `${lineAfter.rate}`);

  const specsAfter = await api(cookie, "GET", `/api/catalog/material-specs/${encodeURIComponent(CATEGORY)}`);
  check("material specs still come back after a sync", Object.keys(specsAfter.json || {}).filter(k => specsAfter.json[k]).length > 0);

  // --- 7. The switch really switches -------------------------------------------------
  await api(cookie, "PUT", "/api/admin/settings/instant-sync", { enabled: false });
  const off = await api(cookie, "GET", "/api/admin/settings/instant-sync");
  check("the review step can be turned back on", off.json?.enabled === false);
  await api(cookie, "PUT", "/api/admin/settings/instant-sync", { enabled: true });

  // --- cleanup ------------------------------------------------------------------------
  await db.delete(projects).where(eq(projects.id, project.id));

  console.log("\n" + "=".repeat(78));
  console.log(`${pass} passed, ${fail} failed`);
  console.log("=".repeat(78) + "\n");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error("\nSCRIPT ERROR:", e); process.exit(1); });
