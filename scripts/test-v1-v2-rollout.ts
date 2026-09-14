/**
 * Validates the exact client rollout promise against temporary development data:
 *
 *   - existing V1 quotations stay on V1 after V2 is published;
 *   - V1 additions and edits remain usable and retain their saved prices;
 *   - new quotations are stamped V2 after publication;
 *   - V2-only catalog rows do not leak into V1; and
 *   - User and Admin views agree for the same quotation.
 *
 * It creates a temporary Draft copied from the current live version, publishes that
 * temporary Draft, then restores the original development version state in finally.
 * It never connects to production.
 *
 * Usage: npx tsx scripts/test-v1-v2-rollout.ts
 */
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import puppeteer from "puppeteer";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  catalogItems,
  pricingVersionAudit,
  pricingVersions,
  projects,
  users,
} from "@shared/schema";
import { copyVersionItems, getActiveVersion } from "../server/pricing-versions";
import { confirmDatabaseTarget } from "./lib/db-target";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
const ADMIN = `v2-rollout-admin-${randomBytes(5).toString("hex")}`;
const USER = `v2-rollout-user-${randomBytes(5).toString("hex")}`;
const ADMIN_PASS = `pv-${randomBytes(18).toString("base64url")}`;
const USER_PASS = `pv-${randomBytes(18).toString("base64url")}`;
const V2_ITEM_CODE = `V2ONLY-${randomBytes(5).toString("hex").toUpperCase()}`;

let passed = 0;
let failed = 0;
let adminId: string | undefined;
let userId: string | undefined;
let adminCookie = "";
let originalInstantSync = true;
let originalActive: any;
let originalDraft: any;
let temporaryVersionId: string | undefined;
let generatedDraftId: string | undefined;
const temporaryProjectIds: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed++;
  else failed++;
}

async function api(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Error text is retained for test diagnostics.
  }
  return { status: res.status, json, text };
}

async function createUser(username: string, password: string, role: "admin" | "user") {
  const hash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ username, password: hash, role, status: "active" } as any)
    .returning();
  return user.id;
}

async function login(username: string, password: string) {
  const response = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`Login failed for ${username}: ${response.status} ${await response.text()}`);
  const cookie = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "";
  if (!cookie) throw new Error("Login did not return a session cookie.");
  return cookie.split(";")[0];
}

async function loginInBrowser(page: any, username: string, password: string) {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-testid="input-username"]');
  await page.type('[data-testid="input-username"]', username);
  await page.type('[data-testid="input-password"]', password);
  await page.click('[data-testid="button-submit-login"]');
  // The login page is also served at "/", so waiting on the URL would resolve before
  // the authenticated redirect happens. Wait for a dashboard-only element instead.
  await page.waitForSelector('[data-testid="button-create-project"]', { timeout: 15_000 });
}

async function verifyPdfExport(page: any, projectId: string, expectedVersionName: string) {
  await page.goto(`${BASE}/project/${projectId}`, { waitUntil: "networkidle2" });
  try {
    await page.waitForSelector('[data-testid="badge-pricing-version"]');
  } catch {
    const text = await page.$eval("body", (element: Element) => (element.textContent || "").slice(0, 500));
    throw new Error(`Project screen did not load for browser test. URL: ${page.url()}. Page text: ${text}`);
  }
  const badge = await page.$eval('[data-testid="badge-pricing-version"]', (element: Element) => element.textContent || "");
  check(`browser shows the ${expectedVersionName} price badge`, badge.includes(expectedVersionName), badge);

  await page.click('[data-testid="button-export-pdf"]');
  await page.waitForSelector('[data-testid="button-download-pdf"]');
  const pdfResponse = page.waitForResponse(
    (response: any) => response.url().includes(`/api/projects/${projectId}/pdf`) && response.status() === 200,
    { timeout: 60_000 }
  );
  await page.click('[data-testid="button-download-pdf"]');
  const pdf = await pdfResponse;
  check(
    `${expectedVersionName} quotation PDF is generated from the browser`,
    String(pdf.headers()["content-type"] || "").includes("application/pdf"),
    pdf.headers()["content-type"] || "no content type"
  );
}

function requestCatalog(cookie: string, projectId: string) {
  return api(
    cookie,
    "GET",
    `/api/catalog?projectId=${encodeURIComponent(projectId)}&category=${encodeURIComponent("DeX - Xpress")}&roomType=${encodeURIComponent("Dry / Inexposed")}`
  );
}

async function saveLine(cookie: string, roomId: string, item: any, description: string) {
  return api(cookie, "POST", `/api/rooms/${roomId}/line-items`, {
    description,
    unitType: item.unitType || "General",
    lengthFt: 1,
    heightFt: 0,
    quantity: 1,
    rate: item.sellingPrice ?? item.rate ?? 0,
    itemType: item.itemType || "woodworks",
  });
}

async function restoreDevelopmentState() {
  // Restore the HTTP server's setting first; this also refreshes its in-memory cache.
  if (adminCookie) {
    await api(adminCookie, "PUT", "/api/admin/settings/instant-sync", { enabled: originalInstantSync });
  }

  if (temporaryProjectIds.length) {
    await db.delete(projects).where(inArray(projects.id, temporaryProjectIds));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
  if (adminId) await db.delete(users).where(eq(users.id, adminId));

  // Publishing generated a new Draft. Delete its rows before its parent version so
  // no temporary catalog data or version record survives the test.
  if (generatedDraftId) {
    await db.delete(catalogItems).where(eq(catalogItems.pricingVersionId, generatedDraftId));
    await db.delete(pricingVersionAudit).where(eq(pricingVersionAudit.versionId, generatedDraftId));
    await db.delete(pricingVersions).where(eq(pricingVersions.id, generatedDraftId));
  }
  if (temporaryVersionId) {
    await db
      .update(pricingVersions)
      .set({ status: "archived" })
      .where(eq(pricingVersions.id, temporaryVersionId));
    await db.delete(catalogItems).where(eq(catalogItems.pricingVersionId, temporaryVersionId));
    await db.delete(pricingVersionAudit).where(eq(pricingVersionAudit.versionId, temporaryVersionId));
    await db.delete(pricingVersions).where(eq(pricingVersions.id, temporaryVersionId));
  }

  // The original active and Draft rows were never changed except for their temporary
  // statuses. Restore their exact version metadata after the test rows are gone.
  if (originalActive) {
    await db
      .update(pricingVersions)
      .set({
        status: originalActive.status,
        archivedAt: originalActive.archivedAt,
        updatedAt: originalActive.updatedAt,
      })
      .where(eq(pricingVersions.id, originalActive.id));
  }
  if (originalDraft) {
    await db
      .update(pricingVersions)
      .set({ status: originalDraft.status, updatedAt: originalDraft.updatedAt })
      .where(eq(pricingVersions.id, originalDraft.id));
  }
}

async function main() {
  await confirmDatabaseTarget("test-v1-v2-rollout");

  originalActive = await getActiveVersion();
  [originalDraft] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "draft")).limit(1);
  if (!originalActive || !originalDraft) throw new Error("Development needs one active version and one Draft.");

  adminId = await createUser(ADMIN, ADMIN_PASS, "admin");
  userId = await createUser(USER, USER_PASS, "user");
  adminCookie = await login(ADMIN, ADMIN_PASS);
  const userCookie = await login(USER, USER_PASS);

  const syncSetting = await api(adminCookie, "GET", "/api/admin/settings/instant-sync");
  if (syncSetting.status !== 200) throw new Error(`Could not read instant-sync: ${syncSetting.text}`);
  originalInstantSync = syncSetting.json.enabled;

  console.log(`\nV1 under test: ${originalActive.name}. Temporary V2 item: ${V2_ITEM_CODE}\n`);

  // Preserve the real Draft untouched and make an isolated draft copied from V1.
  await db.update(pricingVersions).set({ status: "archived" }).where(eq(pricingVersions.id, originalDraft.id));
  const [{ maxVersion }] = await db
    .select({ maxVersion: sql<number>`COALESCE(MAX(${pricingVersions.versionNumber}), 0)::int` })
    .from(pricingVersions);
  const [temporaryDraft] = await db
    .insert(pricingVersions)
    .values({
      versionNumber: Number(maxVersion) + 100,
      name: "TEMP V2 rollout validation",
      status: "draft",
      seededFromVersionId: originalActive.id,
      notes: "Temporary development-only rollout validation.",
    })
    .returning();
  temporaryVersionId = temporaryDraft.id;
  await copyVersionItems(db, originalActive.id, temporaryDraft.id);

  const [template] = await db
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.pricingVersionId, originalActive.id),
        eq(catalogItems.categoryName, "DeX - Xpress"),
        eq(catalogItems.roomType, "Dry / Inexposed")
      )
    )
    .orderBy(desc(catalogItems.sheetRowId))
    .limit(1);
  if (!template) throw new Error("No Dry Xpress catalog item exists for validation.");

  const { id: _id, pricingVersionId: _version, createdAt: _createdAt, updatedAt: _updatedAt, ...newV2Item } = template as any;
  await db.insert(catalogItems).values({
    ...newV2Item,
    pricingVersionId: temporaryDraft.id,
    sheetRowId: 999999,
    itemCode: V2_ITEM_CODE,
    description: "TEMP V2-only rollout validation item",
    rate: 9876,
    sellingPrice: 9876,
  });

  const reviewMode = await api(adminCookie, "PUT", "/api/admin/settings/instant-sync", { enabled: false });
  check("review mode can be enabled before V2 rollout", reviewMode.status === 200 && reviewMode.json?.enabled === false);

  // Existing V1 project: add a saved line and update project details before V2 exists.
  const v1Project = await api(userCookie, "POST", "/api/projects", {
    clientName: "TEMP V1 rollout validation",
    projectType: "Residential",
    defaultCategory: "DeX - Xpress",
  });
  check("existing V1 project is created on V1", v1Project.status === 201 && v1Project.json?.pricingVersionId === originalActive.id);
  if (!v1Project.json?.id) throw new Error(`Could not create V1 project: ${v1Project.text}`);
  temporaryProjectIds.push(v1Project.json.id);

  const v1Room = await api(userCookie, "POST", `/api/projects/${v1Project.json.id}/rooms`, {
    roomName: "V1 room",
    roomType: "Dry / Inexposed",
    category: "DeX - Xpress",
  });
  check("V1 project accepts a room", v1Room.status === 201);
  if (!v1Room.json?.id) throw new Error(`Could not create V1 room: ${v1Room.text}`);

  const beforePublishCatalog = await requestCatalog(userCookie, v1Project.json.id);
  const v1Item = (beforePublishCatalog.json || []).find((item: any) => item.itemCode && item.itemCode !== V2_ITEM_CODE);
  check("V1 catalog excludes the V2-only item before publish", !(beforePublishCatalog.json || []).some((item: any) => item.itemCode === V2_ITEM_CODE));
  if (!v1Item) throw new Error("Could not find a V1 item for the saved-line validation.");

  const v1Line = await saveLine(userCookie, v1Room.json.id, v1Item, "TEMP V1 saved line");
  check("new V1 line item saves in the V1 project", v1Line.status === 201 && v1Line.json?.id);
  const v1AmountBefore = v1Line.json?.amount;
  const projectEdit = await api(userCookie, "PATCH", `/api/projects/${v1Project.json.id}`, { clientName: "TEMP V1 updated" });
  check("V1 project details remain editable", projectEdit.status === 200 && projectEdit.json?.clientName === "TEMP V1 updated");

  // Publish temporary V2 via the same admin endpoint the client will use.
  const published = await api(adminCookie, "POST", "/api/admin/pricing-versions/publish", {
    name: "TEMP V2 rollout validation",
    notes: "Development-only validation; automatically cleaned up.",
  });
  check("temporary V2 publishes successfully", published.status === 200 && published.json?.version?.id === temporaryDraft.id, published.text.slice(0, 120));
  generatedDraftId = published.json?.version ? (await db.select().from(pricingVersions).where(eq(pricingVersions.status, "draft")).limit(1))[0]?.id : undefined;

  const v1Badge = await api(userCookie, "GET", `/api/pricing-version?projectId=${v1Project.json.id}`);
  check("V1 badge remains V1 after V2 publish", v1Badge.status === 200 && v1Badge.json?.version?.id === originalActive.id);
  const v1CatalogAfter = await requestCatalog(userCookie, v1Project.json.id);
  check("V2-only catalog item remains excluded from V1", !(v1CatalogAfter.json || []).some((item: any) => item.itemCode === V2_ITEM_CODE));
  const v1LinesAfter = await api(userCookie, "GET", `/api/projects/${v1Project.json.id}/line-items`);
  const savedV1Line = (v1LinesAfter.json || []).find((line: any) => line.id === v1Line.json?.id);
  check("saved V1 price and total survive V2 publish", savedV1Line?.amount === v1AmountBefore && savedV1Line?.rate === v1Line.json?.rate);

  const v1AdditionAfterPublish = await saveLine(userCookie, v1Room.json.id, v1Item, "TEMP V1 addition after V2 publish");
  check("new V1 line item can be added after V2 publish", v1AdditionAfterPublish.status === 201 && v1AdditionAfterPublish.json?.id);
  const v1EditAfterPublish = await api(userCookie, "PATCH", `/api/projects/${v1Project.json.id}`, {
    clientName: "TEMP V1 changed after V2 publish",
  });
  const adminV1Project = await api(adminCookie, "GET", `/api/projects/${v1Project.json.id}`);
  check(
    "V1 changes after V2 publish are visible to the team",
    v1EditAfterPublish.status === 200 && adminV1Project.json?.clientName === "TEMP V1 changed after V2 publish"
  );
  const v1LinesAfterAddition = await api(userCookie, "GET", `/api/projects/${v1Project.json.id}/line-items`);
  check(
    "new V1 line remains saved after refresh",
    (v1LinesAfterAddition.json || []).some((line: any) => line.id === v1AdditionAfterPublish.json?.id)
  );

  // A new project must now be stamped V2 and see the V2-only catalog entry.
  const v2Project = await api(userCookie, "POST", "/api/projects", {
    clientName: "TEMP V2 rollout validation",
    projectType: "Residential",
    defaultCategory: "DeX - Xpress",
  });
  check("new project after publish is created on V2", v2Project.status === 201 && v2Project.json?.pricingVersionId === temporaryDraft.id);
  if (!v2Project.json?.id) throw new Error(`Could not create V2 project: ${v2Project.text}`);
  temporaryProjectIds.push(v2Project.json.id);

  const v2Room = await api(userCookie, "POST", `/api/projects/${v2Project.json.id}/rooms`, {
    roomName: "V2 room",
    roomType: "Dry / Inexposed",
    category: "DeX - Xpress",
  });
  check("V2 project accepts a room", v2Room.status === 201);

  const userV2Catalog = await requestCatalog(userCookie, v2Project.json.id);
  const adminV2Catalog = await requestCatalog(adminCookie, v2Project.json.id);
  const userCodes = (userV2Catalog.json || []).map((item: any) => item.id).sort().join(",");
  const adminCodes = (adminV2Catalog.json || []).map((item: any) => item.id).sort().join(",");
  const v2OnlyItem = (userV2Catalog.json || []).find((item: any) => item.itemCode === V2_ITEM_CODE);
  check("V2 catalog includes the V2-only item", !!v2OnlyItem);
  check("User and Admin receive the same V2 catalog", userCodes === adminCodes);

  const v2Line = await saveLine(userCookie, v2Room.json.id, v2OnlyItem, "TEMP V2-only saved line");
  check("V2-only line item saves in the V2 project", v2Line.status === 201 && v2Line.json?.rate === 9876);
  const v2LinesAfter = await api(userCookie, "GET", `/api/projects/${v2Project.json.id}/line-items`);
  check("saved V2 line remains after refresh", (v2LinesAfter.json || []).some((line: any) => line.id === v2Line.json?.id && line.rate === 9876));
  check(
    "V1 additions do not appear in the V2 project",
    !(v2LinesAfter.json || []).some((line: any) => line.id === v1AdditionAfterPublish.json?.id)
  );

  const v2Badge = await api(userCookie, "GET", `/api/pricing-version?projectId=${v2Project.json.id}`);
  check("V2 badge matches the new project catalog", v2Badge.status === 200 && v2Badge.json?.version?.id === temporaryDraft.id);

  // Browser rehearsal: the same temporary accounts use the real login form and
  // quotation screens. This complements the HTTP checks above with the client-facing
  // pages, including the PDF action an Admin will use before rollout.
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox"],
  });
  try {
    const adminPage = await browser.newPage();
    await adminPage.setViewport({ width: 1440, height: 1000 });
    await loginInBrowser(adminPage, ADMIN, ADMIN_PASS);
    await adminPage.goto(`${BASE}/admin/pricing-versions`, { waitUntil: "networkidle2" });
    try {
      await adminPage.waitForSelector('[data-testid="card-draft-provenance"]');
    } catch {
      const text = await adminPage.$eval("body", (element: Element) => (element.textContent || "").slice(0, 500));
      throw new Error(`Admin Pricing Versions screen did not load. URL: ${adminPage.url()}. Page text: ${text}`);
    }
    const adminPricingScreen = await adminPage.content();
    check("Admin can open the Pricing Versions screen in the browser", adminPricingScreen.includes("Pricing") && adminPricingScreen.includes("Draft"));
    await verifyPdfExport(adminPage, v1Project.json.id, originalActive.name);

    // A separate browser context prevents the Admin's session cookie from making the
    // normal-user test accidentally run as an Admin.
    const userContext = await browser.createBrowserContext();
    const userPage = await userContext.newPage();
    await userPage.setViewport({ width: 1440, height: 1000 });
    await loginInBrowser(userPage, USER, USER_PASS);
    await verifyPdfExport(userPage, v2Project.json.id, temporaryDraft.name);
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    failed++;
    console.error("\nERROR:", error.message);
  })
  .finally(async () => {
    try {
      await restoreDevelopmentState();
    } catch (error: any) {
      failed++;
      console.error("\nCLEANUP ERROR:", error.message);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });