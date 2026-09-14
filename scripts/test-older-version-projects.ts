/**
 * A project created on an older price list must still be offered new items.
 *
 * This reproduces the shape of the production incident: a quotation stamped with a price
 * list that was live once and has since been archived, while a newly added product exists
 * only in the list that is live now.
 *
 * With the review workflow OFF (the switch the team runs on), every project reads the live
 * list. With it ON, each project reads the list it was stamped with. Either way, prices
 * already saved on a quotation must not move.
 *
 * DEVELOPMENT ONLY. Run with: npx tsx scripts/test-older-version-projects.ts
 */
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import { db } from "../server/db";
import { catalogItems, pricingVersions, projects, rooms, lineItems, users, projectCatalogExceptions } from "@shared/schema";

const BASE = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
const ADMIN = "pv-ui-test";
const PLAIN_USER = "pv-user-test";
const ADMIN_PASS = `pv-${randomBytes(18).toString("base64url")}`;
const USER_PASS = `pv-${randomBytes(18).toString("base64url")}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

async function provision(username: string, password: string, role: "admin" | "user"): Promise<string> {
  const hash = await bcrypt.hash(password, 10);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (existing) {
    await db.update(users).set({ password: hash, role, status: "active" }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [created] = await db.insert(users).values({ username, password: hash, role, status: "active" } as any).returning();
  return created.id;
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${username}: ${res.status} ${await res.text()}`);
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

const setSwitch = (cookie: string, enabled: boolean) =>
  api(cookie, "PUT", "/api/admin/settings/instant-sync", { enabled });

async function main() {
  console.log("\n" + "=".repeat(78));
  console.log("PROJECTS ON AN OLDER PRICE LIST");
  console.log("=".repeat(78) + "\n");

  const adminId = await provision(ADMIN, ADMIN_PASS, "admin");
  const userId = await provision(PLAIN_USER, USER_PASS, "user");
  const adminCookie = await login(ADMIN, ADMIN_PASS);
  const userCookie = await login(PLAIN_USER, USER_PASS);

  const [live] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "active")).limit(1);
  if (!live) throw new Error("No live version in dev.");

  // The archived list that is furthest behind — the closest match to the production case.
  const archivedRows = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "archived"));
  let stale: typeof archivedRows[number] | undefined;
  let staleMissing = 0;
  for (const v of archivedRows) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.pricingVersionId, live.id),
          isNotNull(catalogItems.itemCode),
          sql`${catalogItems.itemCode} NOT IN (SELECT item_code FROM catalog_items WHERE pricing_version_id = ${v.id} AND item_code IS NOT NULL)`
        )
      );
    if (n > staleMissing) { staleMissing = n; stale = v; }
  }
  if (!stale) throw new Error("No archived version in dev is missing any live item — cannot reproduce the case.");

  console.log(`Live: ${live.name}. Older list under test: ${stale.name} (missing ${staleMissing} item(s) the live list has).\n`);

  // One product that exists in the live list and not in the older one — the "new item".
  // Pick a Dry-room row because the screen always requests a room-specific catalog.
  // Several sheet rows intentionally share a code across Wet and Dry variants; asking
  // for an unfiltered catalog would make those legitimate variants look duplicated.
  const [newItem] = await db
    .select({ itemCode: catalogItems.itemCode, categoryName: catalogItems.categoryName, roomType: catalogItems.roomType, description: catalogItems.description })
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.pricingVersionId, live.id),
        isNotNull(catalogItems.itemCode),
        sql`(${catalogItems.roomType} = 'Dry / Inexposed' OR trim(coalesce(${catalogItems.roomType}, '')) = '')`,
        sql`${catalogItems.itemCode} NOT IN (SELECT item_code FROM catalog_items WHERE pricing_version_id = ${stale.id} AND item_code IS NOT NULL)`
      )
    )
    .limit(1);
  console.log(`  "New" product: ${newItem.itemCode} — ${(newItem.description || "").slice(0, 60)} [${newItem.categoryName}]\n`);

  // A quotation on the older list, owned by a NON-ADMIN, with money already saved on it.
  const [project] = await db
    .insert(projects)
    .values({ userId, clientName: "TEMP older-list check", projectType: "Residential", defaultCategory: newItem.categoryName, pricingVersionId: stale.id } as any)
    .returning();
  const [room] = await db
    .insert(rooms)
    .values({ projectId: project.id, roomName: "Kitchen", roomType: "Dry / Inexposed", category: newItem.categoryName } as any)
    .returning();
  const [savedLine] = await db
    .insert(lineItems)
    .values({ roomId: room.id, projectId: project.id, description: "TEMP saved line", unitType: "General", lengthFt: 1, heightFt: 1, sqft: 1, lengthMm: 300, heightMm: 300, rate: 4321, quantity: 1, amount: 4321, itemType: "woodworks" } as any)
    .returning();

  const catalogFor = async (cookie: string) =>
    api(
      cookie,
      "GET",
      `/api/catalog?projectId=${project.id}&category=${encodeURIComponent(newItem.categoryName)}&roomType=${encodeURIComponent("Dry / Inexposed")}`
    );
  const codesIn = (res: any): string[] => (Array.isArray(res.json) ? res.json.map((i: any) => i.itemCode).filter(Boolean) : []);

  // ---- Review workflow OFF: one catalog for everybody ------------------------------
  await setSwitch(adminCookie, true);

  const asUser = await catalogFor(userCookie);
  const asAdmin = await catalogFor(adminCookie);
  check("a User login is offered the newly added product in an old project", codesIn(asUser).includes(newItem.itemCode!), `${codesIn(asUser).length} items`);
  check("an Admin login is offered exactly the same thing", codesIn(asAdmin).includes(newItem.itemCode!) && codesIn(asAdmin).length === codesIn(asUser).length, `${codesIn(asAdmin).length} items`);

  const codes = codesIn(asUser);
  check("no product is offered twice", new Set(codes).size === codes.length, `${codes.length} rows, ${new Set(codes).size} distinct`);

  const badgeOff = await api(userCookie, "GET", `/api/pricing-version?projectId=${project.id}`);
  check("the version shown on screen is the one actually served", badgeOff.json?.version?.id === live.id, badgeOff.json?.version?.name || "none");

  const [lineNow] = await db.select().from(lineItems).where(eq(lineItems.id, savedLine.id));
  check("money already saved on the quotation did not move", lineNow.rate === savedLine.rate && lineNow.amount === savedLine.amount, `${lineNow.rate}`);

  // A duplicate inherits the old list, and must behave the same way.
  const dup = await api(userCookie, "POST", `/api/projects/${project.id}/duplicate`);
  const dupId = dup.json?.id;
  check("a project can be duplicated", !!dupId, dup.status === 200 ? "" : dup.text.slice(0, 120));
  if (dupId) {
    const dupCatalog = await api(userCookie, "GET", `/api/catalog?projectId=${dupId}&category=${encodeURIComponent(newItem.categoryName)}`);
    check("a duplicated project is offered the newly added product too", codesIn(dupCatalog).includes(newItem.itemCode!), `${codesIn(dupCatalog).length} items`);
  }

  // A product granted to this one quotation must appear once, at its granted price.
  const grant = await api(adminCookie, "POST", `/api/projects/${project.id}/catalog-exceptions`, {
    itemCode: newItem.itemCode,
    sourceVersionId: live.id,
    reason: "TEMP older-list check",
  });
  check("a product can be granted to one quotation", grant.status === 200, grant.status === 200 ? "" : grant.text.slice(0, 160));
  if (grant.status === 200) {
    const afterGrant = await catalogFor(userCookie);
    const rows = (afterGrant.json || []).filter((i: any) => i.itemCode === newItem.itemCode);
    check("a granted product is offered once, not twice", rows.length === 1, `${rows.length} row(s)`);

    // The row that survives deduplication must be the granted one, at the price this
    // quotation was promised — not the catalog's current price. Prove it by making the two
    // differ: drop the grant (which clears the server's cache for this project), then
    // re-grant at a price that is deliberately not the live one.
    const [liveRow] = await db
      .select({ rate: catalogItems.rate, sellingPrice: catalogItems.sellingPrice })
      .from(catalogItems)
      .where(and(eq(catalogItems.pricingVersionId, live.id), eq(catalogItems.itemCode, newItem.itemCode!)))
      .limit(1);
    const promisedRate = (liveRow.rate || 0) + 777;

    await api(adminCookie, "DELETE", `/api/projects/${project.id}/catalog-exceptions/${encodeURIComponent(newItem.itemCode!)}`);
    await db.insert(projectCatalogExceptions).values({
      projectId: project.id,
      itemCode: newItem.itemCode!,
      sourceVersionId: live.id,
      grantedRate: promisedRate,
      grantedSellingPrice: (liveRow.sellingPrice || 0) + 777,
      reason: "TEMP older-list check",
    } as any);

    const atPromisedPrice = await catalogFor(userCookie);
    const promisedRows = (atPromisedPrice.json || []).filter((i: any) => i.itemCode === newItem.itemCode);
    check(
      "the surviving row keeps the price this quotation was granted",
      promisedRows.length === 1 && promisedRows[0].rate === promisedRate,
      `served ${promisedRows[0]?.rate}, granted ${promisedRate}, catalog ${liveRow.rate}`
    );
    await api(adminCookie, "DELETE", `/api/projects/${project.id}/catalog-exceptions/${encodeURIComponent(newItem.itemCode!)}`);
  }

  // ---- Review workflow ON: each project goes back to its own list -------------------
  await setSwitch(adminCookie, false);

  const strictUser = await catalogFor(userCookie);
  check("with review on, the old project is back on its own price list", !codesIn(strictUser).includes(newItem.itemCode!), `${codesIn(strictUser).length} items`);
  const badgeOn = await api(userCookie, "GET", `/api/pricing-version?projectId=${project.id}`);
  check("with review on, the version on screen matches the stamped list", badgeOn.json?.version?.id === stale.id, badgeOn.json?.version?.name || "none");

  // Leave the app the way the team runs it.
  await setSwitch(adminCookie, true);

  // ---- cleanup ----------------------------------------------------------------------
  if (dupId) await db.delete(projects).where(eq(projects.id, dupId));
  await db.delete(projects).where(eq(projects.id, project.id));
  await db.delete(users).where(eq(users.id, userId));

  console.log("\n" + "=".repeat(78));
  console.log(`${pass} passed, ${fail} failed`);
  console.log("=".repeat(78) + "\n");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error("\nSCRIPT ERROR:", e); process.exit(1); });
