/**
 * Catalog Pricing Version Engine — core service.
 *
 * Three layers:
 *   1. Google Sheet  — the editing surface, edited freely by the team
 *   2. Draft         — exactly one always-mutable working copy of the full catalog
 *   3. Published     — immutable numbered snapshots, exactly one of which is Active
 *
 * The central rule: syncing the sheet NEVER creates a version. Only an explicit admin
 * "Publish" does. Version count equals publish clicks, not edit count.
 *
 * A published version always holds the COMPLETE catalog. Items the admin did not touch
 * carry forward at identical prices, so any project can always price any item.
 */
import { db } from "./db";
import { and, eq, sql, desc, inArray, isNull } from "drizzle-orm";
import {
  pricingVersions,
  catalogItems,
  catalogSheetTabs,
  pricingVersionAudit,
  projectCatalogExceptions,
  projects,
  itemCodeSequences,
  type PricingVersion,
  type CatalogSheetTab,
} from "@shared/schema";

/**
 * The one guard that makes "a published version never changes" true.
 *
 * Every guarantee in this system reduces to it: a quotation keeps its prices because the
 * version it points at cannot be rewritten. Enforced here, at the single point where
 * catalog rows are written into a version, rather than route by route — a route added
 * later would not know to check, but it cannot avoid going through here.
 *
 * The only write that does not pass through here is `bootstrapPricingVersions` adopting
 * the pre-existing catalog into V1 as V1 is created — before any quotation could depend
 * on it, and only ever once.
 */
export async function assertVersionMutable(
  tx: any,
  versionId: string,
  context: string
): Promise<PricingVersion> {
  const [version] = await tx.select().from(pricingVersions).where(eq(pricingVersions.id, versionId)).limit(1);
  if (!version) throw new Error(`${context}: that price list does not exist.`);
  if (version.status !== "draft") {
    throw new Error(
      `${context}: ${version.name} is a published price list and cannot be changed. ` +
        `Published prices are frozen so quotations already sent to clients never move. ` +
        `Change prices in the Draft and publish a new version instead.`
    );
  }
  return version;
}

/**
 * Canonical catalog tab configuration.
 *
 * Tabs are pinned by their stable numeric Google Sheets gid because the live
 * spreadsheet contains two tabs whose titles differ only by a trailing space, plus
 * titles containing double spaces. Title matching is ambiguous and order-dependent.
 *
 * This list seeds the `catalog_sheet_tabs` table once; afterwards the table is the
 * source of truth and an admin can add a tab without a code change.
 *
 * `layout` selects the positional column mapping; `itemType` drives GST treatment.
 * Note Handles deliberately uses the xpress_xpand layout (its price is in column J)
 * while being taxed as an accessory.
 */
export const DEFAULT_SHEET_TABS: Array<Omit<CatalogSheetTab, "id" | "createdAt" | "updatedAt">> = [
  { sheetTabId: 1463070649, tabTitle: "DeX - Xpress",        categoryName: "DeX - Xpress",       itemCodePrefix: "XPR", layout: "xpress_xpand",  itemType: "woodworks",   enabled: true, sortOrder: 1 },
  { sheetTabId: 1970451562, tabTitle: "DeX - Xpand",         categoryName: "DeX - Xpand",        itemCodePrefix: "XPD", layout: "xpress_xpand",  itemType: "woodworks",   enabled: true, sortOrder: 2 },
  { sheetTabId: 1433198119, tabTitle: "DeX - Xclusive",      categoryName: "DeX - Xclusive",     itemCodePrefix: "XCL", layout: "xclusive",       itemType: "woodworks",   enabled: true, sortOrder: 3 },
  { sheetTabId: 1996860450, tabTitle: "DeX - Services",      categoryName: "DeX - Services",     itemCodePrefix: "SRV", layout: "services_stone", itemType: "services",   enabled: true, sortOrder: 4 },
  { sheetTabId: 818317477,  tabTitle: "DeX - Accessories ",  categoryName: "DeX - Accessories",  itemCodePrefix: "ACC", layout: "accessories",   itemType: "accessories", enabled: true, sortOrder: 5 },
  { sheetTabId: 15831228,   tabTitle: "DeX -  Lights",       categoryName: "DeX - Lights",       itemCodePrefix: "LGT", layout: "lights",        itemType: "accessories", enabled: true, sortOrder: 6 },
  { sheetTabId: 338353979,  tabTitle: "DeX - Stone Master ", categoryName: "DeX - Stone Master", itemCodePrefix: "STN", layout: "services_stone", itemType: "accessories", enabled: true, sortOrder: 7 },
  { sheetTabId: 1863704353, tabTitle: "DeX - Handles",       categoryName: "DeX - Handles",      itemCodePrefix: "HDL", layout: "xpress_xpand",  itemType: "accessories", enabled: true, sortOrder: 8 },
  { sheetTabId: 1293380484, tabTitle: "DeX- Furniture",      categoryName: "DeX - Furniture",    itemCodePrefix: "FUR", layout: "furniture",     itemType: "furniture",   enabled: true, sortOrder: 9 },
  { sheetTabId: 994463430,  tabTitle: "DeX - Appliances",    categoryName: "DeX - Appliances",   itemCodePrefix: "APL", layout: "appliances",    itemType: "accessories", enabled: true, sortOrder: 10 },
];

/**
 * A stale duplicate of the Services tab exists in the spreadsheet with a different
 * column layout. It is recorded as disabled so it is visible to admins but can never
 * be picked up accidentally by title matching.
 */
export const KNOWN_DISABLED_TABS: Array<Omit<CatalogSheetTab, "id" | "createdAt" | "updatedAt">> = [
  { sheetTabId: 13396685, tabTitle: "DeX - Services ", categoryName: "DeX - Services (legacy)", itemCodePrefix: "SRVL", layout: "services_stone", itemType: "services", enabled: false, sortOrder: 99 },
];

export const ITEM_CODE_PAD = 4;

// ---------------------------------------------------------------- version accessors

export async function getActiveVersion(): Promise<PricingVersion | undefined> {
  const [v] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "active")).limit(1);
  return v;
}

export async function getDraftVersion(): Promise<PricingVersion | undefined> {
  const [v] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "draft")).limit(1);
  return v;
}

export async function getVersion(id: string): Promise<PricingVersion | undefined> {
  const [v] = await db.select().from(pricingVersions).where(eq(pricingVersions.id, id)).limit(1);
  return v;
}

export async function listVersions(): Promise<PricingVersion[]> {
  return db.select().from(pricingVersions).orderBy(desc(pricingVersions.versionNumber));
}

export async function getEnabledTabs(): Promise<CatalogSheetTab[]> {
  return db
    .select()
    .from(catalogSheetTabs)
    .where(eq(catalogSheetTabs.enabled, true))
    .orderBy(catalogSheetTabs.sortOrder);
}

export async function getAllTabs(): Promise<CatalogSheetTab[]> {
  return db.select().from(catalogSheetTabs).orderBy(catalogSheetTabs.sortOrder);
}

// ------------------------------------------------------------------------- auditing

export async function recordAudit(entry: {
  versionId?: string | null;
  action: string;
  catalogItemId?: string | null;
  itemCode?: string | null;
  summary: string;
  details?: Record<string, any>;
  performedBy?: string | null;
}): Promise<void> {
  await db.insert(pricingVersionAudit).values({
    versionId: entry.versionId ?? null,
    action: entry.action,
    catalogItemId: entry.catalogItemId ?? null,
    itemCode: entry.itemCode ?? null,
    summary: entry.summary,
    details: entry.details ?? {},
    performedBy: entry.performedBy ?? null,
  });
}

// --------------------------------------------------------------------- item codes

export function formatItemCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(ITEM_CODE_PAD, "0")}`;
}

/**
 * Reserves a contiguous block of codes for a prefix and returns the first number.
 *
 * The counter only ever increases, so a code belonging to a deleted item is never
 * handed out again and a new product cannot inherit a retired product's history.
 */
export async function reserveItemCodes(prefix: string, count: number): Promise<number> {
  if (count <= 0) {
    const [row] = await db.select().from(itemCodeSequences).where(eq(itemCodeSequences.prefix, prefix)).limit(1);
    return row?.nextValue ?? 1;
  }
  const [row] = await db
    .insert(itemCodeSequences)
    .values({ prefix, nextValue: 1 + count })
    .onConflictDoUpdate({
      target: itemCodeSequences.prefix,
      set: {
        nextValue: sql`${itemCodeSequences.nextValue} + ${count}`,
        updatedAt: new Date(),
      },
    })
    .returning();
  // nextValue now points past the reserved block; the block starts count places back.
  return row.nextValue - count;
}

/**
 * Raises a prefix's counter so it sits above every code already present in the sheet.
 * Used when codes were added by hand, so generated codes never collide with them.
 */
export async function ensureSequenceAtLeast(prefix: string, minNext: number): Promise<void> {
  await db
    .insert(itemCodeSequences)
    .values({ prefix, nextValue: minNext })
    .onConflictDoUpdate({
      target: itemCodeSequences.prefix,
      set: {
        nextValue: sql`GREATEST(${itemCodeSequences.nextValue}, ${minNext})`,
        updatedAt: new Date(),
      },
    });
}

// -------------------------------------------------------------------- tab seeding

/** Seeds the tab configuration table once. Existing rows are left untouched. */
export async function seedSheetTabs(): Promise<{ inserted: number; existing: number }> {
  const existing = await db.select().from(catalogSheetTabs);
  const existingIds = new Set(existing.map((t) => t.sheetTabId));
  const toInsert = [...DEFAULT_SHEET_TABS, ...KNOWN_DISABLED_TABS].filter(
    (t) => !existingIds.has(t.sheetTabId)
  );
  if (toInsert.length > 0) {
    await db.insert(catalogSheetTabs).values(toInsert).onConflictDoNothing();
  }
  return { inserted: toInsert.length, existing: existing.length };
}

// --------------------------------------------------------------------- bootstrap

export interface BootstrapResult {
  created: boolean;
  activeVersionId: string;
  draftVersionId: string;
  catalogItemsAssigned: number;
  draftItemsSeeded: number;
  projectsAssigned: number;
  tabsSeeded: number;
}

/**
 * One-time initialisation, safe to call repeatedly.
 *
 * Creates V1 from the catalog exactly as it stands today — no re-read of the sheet, so
 * V1 is provably identical to what the app is serving right now — marks it Active,
 * stamps every existing project with it, and seeds a Draft copy for future edits.
 */
export async function bootstrapPricingVersions(performedBy?: string): Promise<BootstrapResult> {
  const tabSeed = await seedSheetTabs();

  const existingActive = await getActiveVersion();
  const existingDraft = await getDraftVersion();

  if (existingActive && existingDraft) {
    return {
      created: false,
      activeVersionId: existingActive.id,
      draftVersionId: existingDraft.id,
      catalogItemsAssigned: 0,
      draftItemsSeeded: 0,
      projectsAssigned: 0,
      tabsSeeded: tabSeed.inserted,
    };
  }

  return await db.transaction(async (tx) => {
    // ---- V1: adopt the current catalog exactly as it is -------------------------
    let active = existingActive;
    let catalogItemsAssigned = 0;

    if (!active) {
      const [v1] = await tx
        .insert(pricingVersions)
        .values({
          versionNumber: 1,
          name: "V1 - Initial Catalog",
          status: "active",
          effectiveDate: new Date(),
          notes:
            "Created automatically from the catalog as it stood when pricing versions were introduced. Contents were adopted as-is, not re-read from the sheet, so this version matches exactly what the app was serving beforehand.",
          publishedAt: new Date(),
          publishedBy: performedBy ?? null,
        })
        .returning();
      active = v1;

      const assigned = await tx
        .update(catalogItems)
        .set({ pricingVersionId: v1.id })
        .where(isNull(catalogItems.pricingVersionId))
        .returning({ id: catalogItems.id });
      catalogItemsAssigned = assigned.length;

      await tx
        .update(pricingVersions)
        .set({ itemCount: catalogItemsAssigned })
        .where(eq(pricingVersions.id, v1.id));
    }

    // ---- Stamp every existing project with V1 -----------------------------------
    const stamped = await tx
      .update(projects)
      .set({ pricingVersionId: active!.id })
      .where(isNull(projects.pricingVersionId))
      .returning({ id: projects.id });

    // ---- Draft: a working copy seeded from V1 -----------------------------------
    let draft = existingDraft;
    let draftItemsSeeded = 0;

    if (!draft) {
      const [d] = await tx
        .insert(pricingVersions)
        .values({
          versionNumber: 2,
          name: "Draft",
          status: "draft",
          seededFromVersionId: active!.id,
          notes: "Working copy. Sync the sheet into this as often as needed; it only becomes a version when published.",
        })
        .returning();
      draft = d;

      draftItemsSeeded = await copyVersionItems(tx, active!.id, d.id);
      await tx.update(pricingVersions).set({ itemCount: draftItemsSeeded }).where(eq(pricingVersions.id, d.id));
    }

    await tx.insert(pricingVersionAudit).values({
      versionId: active!.id,
      action: "publish",
      summary: `Initialised pricing versions: V1 adopted ${catalogItemsAssigned} catalog items, ${stamped.length} projects stamped, Draft seeded with ${draftItemsSeeded} items.`,
      details: { catalogItemsAssigned, projectsStamped: stamped.length, draftItemsSeeded },
      performedBy: performedBy ?? null,
    });

    return {
      created: true,
      activeVersionId: active!.id,
      draftVersionId: draft!.id,
      catalogItemsAssigned,
      draftItemsSeeded,
      projectsAssigned: stamped.length,
      tabsSeeded: tabSeed.inserted,
    };
  });
}

/**
 * Copies every catalog row from one version into another, preserving all pricing
 * fields. Uses a single set-based INSERT ... SELECT so a full 2,000+ row catalog is
 * copied atomically rather than row by row.
 */
export async function copyVersionItems(tx: any, fromVersionId: string, toVersionId: string): Promise<number> {
  // Every caller here seeds a Draft. The guard is here so a future caller cannot quietly
  // start copying rows into a published version.
  await assertVersionMutable(tx, toVersionId, "Copying catalog rows");
  return await copyVersionItemsUnchecked(tx, fromVersionId, toVersionId);
}

/**
 * The same copy without the frozen-version guard.
 *
 * Deliberately private. `updateLiveVersion` is the single caller: it rewrites the live
 * version's rows on purpose, which is the one operation the guard exists to prevent, so
 * it has to go around it. Everything else must use `copyVersionItems` — a caller that
 * skips the guard by accident is exactly the failure the guard was written for.
 */
async function copyVersionItemsUnchecked(tx: any, fromVersionId: string, toVersionId: string): Promise<number> {
  const result = await tx.execute(sql`
    INSERT INTO catalog_items (
      sheet_row_id, project_type, section, room_type, room_type_raw, unit_type, unit_type_raw,
      panel_type, panel_type_raw, category_name, category_name_raw, material_type, material_type_raw,
      brand, brand_raw, description, rate, rate_raw, markup, markup_raw, margin, margin_raw,
      selling_price, selling_price_raw, image_url, materials, finishes, specifications, item_type,
      has_errors, error_details, is_valid, sync_log_id, created_by,
      pricing_version_id, item_code, sheet_tab_id, is_backported, backported_from_version_id,
      backported_by, backported_at
    )
    SELECT
      sheet_row_id, project_type, section, room_type, room_type_raw, unit_type, unit_type_raw,
      panel_type, panel_type_raw, category_name, category_name_raw, material_type, material_type_raw,
      brand, brand_raw, description, rate, rate_raw, markup, markup_raw, margin, margin_raw,
      selling_price, selling_price_raw, image_url, materials, finishes, specifications, item_type,
      has_errors, error_details, is_valid, sync_log_id, created_by,
      ${toVersionId}, item_code, sheet_tab_id, is_backported, backported_from_version_id,
      backported_by, backported_at
    FROM catalog_items
    WHERE pricing_version_id = ${fromVersionId}
  `);
  return (result as any).rowCount ?? 0;
}

// The legacy item-code backfill lived here. It gave codes to rows that predated the
// Item Code column, by rewriting rows inside the version that was already live.
//
// It has been removed rather than guarded. It was one-time migration tooling, it has
// already run everywhere it needed to, and the only thing it could do if run again is
// rewrite a published version — precisely what the immutability guarantee forbids. Git
// history holds it if the matching logic is ever needed again.

// ------------------------------------------------------------------------- diffing

export interface VersionDiffRow {
  itemCode: string;
  /** Wet and dry variants share an item code but are priced independently. */
  roomType: string | null;
  categoryName: string;
  description: string | null;
  oldRate: number | null;
  newRate: number | null;
  oldSellingPrice: number | null;
  newSellingPrice: number | null;
  oldImageUrl: string | null;
  newImageUrl: string | null;
  priceChanged: boolean;
  imageChanged: boolean;
  changePct: number | null;
}

export interface VersionDiff {
  fromVersionId: string;
  toVersionId: string;
  changed: VersionDiffRow[];
  added: VersionDiffRow[];
  removed: VersionDiffRow[];
  unchangedCount: number;
  /** Rows that cannot be compared because they carry no item code. */
  uncomparable: { from: number; to: number };
}

/**
 * Compares two versions by item code.
 *
 * Prices are compared per item code rather than per row, because one sheet row can
 * expand into several catalog rows (one per room type) that always share a price.
 */
export async function diffVersions(fromVersionId: string, toVersionId: string): Promise<VersionDiff> {
  const res: any = await db.execute(sql`
    WITH f AS (
      SELECT item_code,
             COALESCE(room_type, '') AS room_type,
             MIN(category_name) AS category_name,
             MIN(description)   AS description,
             MIN(image_url)     AS image_url,
             MAX(rate)          AS rate,
             MAX(selling_price) AS selling_price
      FROM catalog_items
      WHERE pricing_version_id = ${fromVersionId} AND item_code IS NOT NULL
      GROUP BY item_code, COALESCE(room_type, '')
    ),
    t AS (
      SELECT item_code,
             COALESCE(room_type, '') AS room_type,
             MIN(category_name) AS category_name,
             MIN(description)   AS description,
             MIN(image_url)     AS image_url,
             MAX(rate)          AS rate,
             MAX(selling_price) AS selling_price
      FROM catalog_items
      WHERE pricing_version_id = ${toVersionId} AND item_code IS NOT NULL
      GROUP BY item_code, COALESCE(room_type, '')
    )
    SELECT
      COALESCE(f.item_code, t.item_code)         AS item_code,
      COALESCE(f.room_type, t.room_type)         AS room_type,
      COALESCE(t.category_name, f.category_name) AS category_name,
      COALESCE(t.description, f.description)     AS description,
      f.rate           AS old_rate,
      t.rate           AS new_rate,
      f.selling_price  AS old_selling_price,
      t.selling_price  AS new_selling_price,
      f.image_url      AS old_image_url,
      t.image_url      AS new_image_url,
      (f.rate IS DISTINCT FROM t.rate
        OR f.selling_price IS DISTINCT FROM t.selling_price) AS price_changed,
      (f.image_url IS DISTINCT FROM t.image_url) AS image_changed,
      CASE WHEN f.item_code IS NULL THEN 'added'
           WHEN t.item_code IS NULL THEN 'removed'
           WHEN f.rate IS DISTINCT FROM t.rate
              OR f.selling_price IS DISTINCT FROM t.selling_price
              OR f.image_url IS DISTINCT FROM t.image_url THEN 'changed'
           ELSE 'unchanged' END AS kind
    FROM f FULL OUTER JOIN t
      ON f.item_code = t.item_code AND f.room_type = t.room_type
  `);

  const rows = (res.rows ?? res) as any[];
  const diff: VersionDiff = {
    fromVersionId,
    toVersionId,
    changed: [],
    added: [],
    removed: [],
    unchangedCount: 0,
    uncomparable: { from: 0, to: 0 },
  };

  for (const r of rows) {
    if (r.kind === 'unchanged') {
      diff.unchangedCount++;
      continue;
    }
    const oldPrice = r.old_selling_price ?? r.old_rate;
    const newPrice = r.new_selling_price ?? r.new_rate;
    const row: VersionDiffRow = {
      itemCode: r.item_code,
      roomType: r.room_type || null,
      categoryName: r.category_name,
      description: r.description,
      oldRate: r.old_rate,
      newRate: r.new_rate,
      oldSellingPrice: r.old_selling_price,
      newSellingPrice: r.new_selling_price,
      oldImageUrl: r.old_image_url,
      newImageUrl: r.new_image_url,
      priceChanged: r.price_changed === true,
      imageChanged: r.image_changed === true,
      changePct:
        r.price_changed === true && oldPrice && newPrice && Number(oldPrice) !== 0
          ? Math.round(((Number(newPrice) - Number(oldPrice)) / Number(oldPrice)) * 1000) / 10
          : null,
    };
    if (r.kind === 'added') diff.added.push(row);
    else if (r.kind === 'removed') diff.removed.push(row);
    else diff.changed.push(row);
  }

  const [fromU] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(and(eq(catalogItems.pricingVersionId, fromVersionId), isNull(catalogItems.itemCode)));
  const [toU] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(and(eq(catalogItems.pricingVersionId, toVersionId), isNull(catalogItems.itemCode)));
  diff.uncomparable = { from: fromU?.n ?? 0, to: toU?.n ?? 0 };

  return diff;
}

/** The change preview an admin sees before publishing: Draft vs the live Active version. */
export async function previewPublish(): Promise<VersionDiff & { draftItemCount: number }> {
  const active = await getActiveVersion();
  const draft = await getDraftVersion();
  if (!active || !draft) throw new Error('Pricing versions are not initialised.');
  const diff = await diffVersions(active.id, draft.id);
  return { ...diff, draftItemCount: await countVersionItems(draft.id) };
}

// ------------------------------------------------------------------- publishing

export interface PublishOptions {
  name?: string;
  notes?: string | null;
  performedBy?: string;
  /**
   * Apply only if the Draft is still the one the caller read.
   *
   * Reading the sheet and writing the Draft is one committed transaction; making the
   * result live is another. In between, a second sync or a manual edit can rewrite the
   * Draft, and this call would then push somebody else's rows live under this admin's
   * name. Passing the Draft's identity and its last-updated stamp makes that a refusal
   * instead.
   */
  expectDraft?: { id: string; updatedAt: Date | string | null };
}

/**
 * Publishes the Draft as the new Active version.
 *
 * The Draft is promoted in place rather than copied: it already holds the complete
 * catalog, so promoting it makes the published version an exact, immutable record of
 * what was reviewed. A fresh Draft is then seeded from it for the next round of edits.
 *
 * Existing projects are untouched — each one keeps the version it was created against,
 * so a quotation sent to a client never changes price behind their back.
 */
export async function publishDraft(options: PublishOptions = {}): Promise<PricingVersion> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(918273645)`);

    const [draft] = await tx.select().from(pricingVersions).where(eq(pricingVersions.status, 'draft')).limit(1);
    if (!draft) throw new Error('There is no Draft to publish.');

    const [{ n: draftCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(eq(catalogItems.pricingVersionId, draft.id));

    if (draftCount === 0) {
      throw new Error('The Draft is empty. Sync the sheet before publishing so the new version holds the full catalog.');
    }

    const [prevActive] = await tx.select().from(pricingVersions).where(eq(pricingVersions.status, 'active')).limit(1);

    // A published version must always be the complete catalog. Publishing something
    // dramatically smaller than the live version almost certainly means a failed sync,
    // so it is refused rather than silently shrinking the catalog.
    if (prevActive) {
      const [{ n: activeCount }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(catalogItems)
        .where(eq(catalogItems.pricingVersionId, prevActive.id));
      if (activeCount > 0 && draftCount < activeCount * 0.5) {
        throw new Error(
          `Refusing to publish: the Draft has ${draftCount} items but the live version has ${activeCount}. ` +
            `That looks like an incomplete sync. Re-sync the sheet and check the preview before publishing.`
        );
      }
    }

    // Order matters: the single-active and single-draft invariants are enforced by
    // partial unique indexes, so the old rows must be vacated before the new ones land.
    if (prevActive) {
      await tx
        .update(pricingVersions)
        .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(pricingVersions.id, prevActive.id));
    }

    const [published] = await tx
      .update(pricingVersions)
      .set({
        status: 'active',
        name: options.name?.trim() || `V${draft.versionNumber}`,
        // A version goes live the instant it is published; there is no scheduling. The
        // column is kept only so historical rows stay readable.
        effectiveDate: new Date(),
        notes: options.notes ?? null,
        itemCount: draftCount,
        publishedAt: new Date(),
        publishedBy: options.performedBy ?? null,
        updatedAt: new Date(),
      })
      .where(eq(pricingVersions.id, draft.id))
      .returning();

    // Seed the next Draft from what was just published.
    const [newDraft] = await tx
      .insert(pricingVersions)
      .values({
        versionNumber: draft.versionNumber + 1,
        name: 'Draft',
        status: 'draft',
        seededFromVersionId: published.id,
        notes: 'Working copy. Sync the sheet into this as often as needed; it only becomes a version when published.',
      })
      .returning();

    const seeded = await copyVersionItems(tx, published.id, newDraft.id);
    await tx.update(pricingVersions).set({ itemCount: seeded }).where(eq(pricingVersions.id, newDraft.id));

    await tx.insert(pricingVersionAudit).values({
      versionId: published.id,
      action: 'publish',
      summary: `Published ${published.name} with ${draftCount} items. It is now the live version for new projects. ${
        prevActive ? `${prevActive.name} was archived.` : ''
      }`,
      details: {
        previousActive: prevActive ? { id: prevActive.id, name: prevActive.name } : null,
        itemCount: draftCount,
        newDraftId: newDraft.id,
      },
      performedBy: options.performedBy ?? null,
    });

    return published;
  });
}

export interface UpdateLiveResult {
  version: PricingVersion;
  changed: number;
  added: number;
  removed: number;
  itemCount: number;
}

/**
 * Applies the reviewed Draft onto the version that is already live, in place.
 *
 * The alternative — publishing — creates a new numbered version, and every project keeps
 * the version it was created against. That is correct for a genuine price edition, but it
 * means a newly added product never reaches the hundreds of projects already running on
 * the live version: the team has to recreate the quotation to use it. This path exists so
 * a new product or a corrected rate can reach those projects immediately, without a new
 * edition and without renumbering anything.
 *
 * What this does NOT do is move money already quoted. A line item stores its own rate and
 * amount when it is added, so rewriting the catalog behind it changes nothing on any
 * existing quotation — only what is available, and at what price, for lines added from
 * now on. That is the whole reason this is safe to do at all.
 *
 * Removals are the one thing to watch: an item dropped from the Draft disappears from the
 * live catalog for everyone on it. The admin sees removals in the preview and confirms
 * them, the same as for a publish.
 */
export async function updateLiveVersion(options: PublishOptions = {}): Promise<UpdateLiveResult> {
  return await db.transaction(async (tx) => {
    // Same lock as publishing: the two must never interleave, or a publish could archive
    // the very version this is rewriting.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(918273645)`);

    const [draft] = await tx.select().from(pricingVersions).where(eq(pricingVersions.status, 'draft')).limit(1);
    if (!draft) throw new Error('There is no Draft to apply.');

    if (options.expectDraft) {
      const expected = options.expectDraft;
      const sameDraft = expected.id === draft.id;
      const expectedStamp = expected.updatedAt ? new Date(expected.updatedAt).getTime() : null;
      const actualStamp = draft.updatedAt ? new Date(draft.updatedAt).getTime() : null;
      if (!sameDraft || expectedStamp !== actualStamp) {
        throw new Error(
          'The Draft changed while this was running — someone else synced or published at the same time. ' +
            'Nothing was applied. Check the Draft preview and apply it again.'
        );
      }
    }

    const [active] = await tx.select().from(pricingVersions).where(eq(pricingVersions.status, 'active')).limit(1);
    if (!active) throw new Error('There is no live price list to update. Publish the Draft first.');

    const [{ n: draftCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(eq(catalogItems.pricingVersionId, draft.id));

    if (draftCount === 0) {
      throw new Error('The Draft is empty. Sync the sheet before updating the live price list.');
    }

    const [{ n: activeCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(eq(catalogItems.pricingVersionId, active.id));

    // Identical protection to publishing: a Draft dramatically smaller than what is live
    // almost always means a failed sync, and here the damage would land on the version
    // every current project reads from.
    if (activeCount > 0 && draftCount < activeCount * 0.5) {
      throw new Error(
        `Refusing to update: the Draft has ${draftCount} items but the live price list has ${activeCount}. ` +
          `That looks like an incomplete sync. Re-sync the sheet and check the preview before updating.`
      );
    }

    // Guard: do not copy un-coded rows into the live catalog. A null item_code means the
    // row has never been through Generate Codes, so the diff cannot track it and it would
    // be invisible to every future comparison. The admin must generate codes and re-sync
    // the sheet before updating live.
    const [{ n: nullCodeCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(and(eq(catalogItems.pricingVersionId, draft.id), isNull(catalogItems.itemCode)));

    if (nullCodeCount > 0) {
      throw new Error(
        `The Draft contains ${nullCodeCount} item${nullCodeCount === 1 ? '' : 's'} with no item code. ` +
          `Go to Sheet Wiring → Item Codes, generate codes, then re-sync the sheet before updating the live price list.`
      );
    }

    // Counted inside the transaction so the audit summary describes exactly what this
    // call applied, not what a preview happened to show a few seconds earlier.
    const countsRes: any = await tx.execute(sql`
      WITH f AS (
        SELECT item_code, COALESCE(room_type, '') AS room_type,
               MAX(rate) AS rate, MAX(selling_price) AS selling_price,
               MIN(image_url) AS image_url
        FROM catalog_items
        WHERE pricing_version_id = ${active.id} AND item_code IS NOT NULL
        GROUP BY item_code, COALESCE(room_type, '')
      ),
      t AS (
        SELECT item_code, COALESCE(room_type, '') AS room_type,
               MAX(rate) AS rate, MAX(selling_price) AS selling_price,
               MIN(image_url) AS image_url
        FROM catalog_items
        WHERE pricing_version_id = ${draft.id} AND item_code IS NOT NULL
        GROUP BY item_code, COALESCE(room_type, '')
      )
      SELECT
        COUNT(*) FILTER (WHERE f.item_code IS NULL)::int AS added,
        COUNT(*) FILTER (WHERE t.item_code IS NULL)::int AS removed,
        COUNT(*) FILTER (
          WHERE f.item_code IS NOT NULL AND t.item_code IS NOT NULL
            AND (
              f.rate IS DISTINCT FROM t.rate
              OR f.selling_price IS DISTINCT FROM t.selling_price
              OR f.image_url IS DISTINCT FROM t.image_url
            )
        )::int AS changed
      FROM f FULL OUTER JOIN t
        ON f.item_code = t.item_code AND f.room_type = t.room_type
    `);
    const counts = (countsRes.rows ?? countsRes)[0] ?? { added: 0, removed: 0, changed: 0 };

    // Replace the live version's rows wholesale. Its id, number and name are untouched,
    // so every project pinned to it stays pinned and simply sees the new catalog.
    await tx.delete(catalogItems).where(eq(catalogItems.pricingVersionId, active.id));
    const copied = await copyVersionItemsUnchecked(tx, draft.id, active.id);

    const [updated] = await tx
      .update(pricingVersions)
      .set({
        itemCount: copied,
        notes: options.notes ?? active.notes,
        updatedAt: new Date(),
      })
      .where(eq(pricingVersions.id, active.id))
      .returning();

    // The Draft is now an exact copy of what is live, so the next preview correctly shows
    // nothing pending. It keeps its number: no version was consumed.
    await tx.update(pricingVersions).set({ itemCount: copied, updatedAt: new Date() }).where(eq(pricingVersions.id, draft.id));

    await tx.insert(pricingVersionAudit).values({
      versionId: active.id,
      action: 'update_live',
      summary:
        `Updated the live price list ${active.name} in place: ${Number(counts.added)} item(s) added, ` +
        `${Number(counts.changed)} catalog item(s) changed, ${Number(counts.removed)} removed. ` +
        `No new version was created — all ${active.name} projects can use these items immediately. ` +
        `Prices already saved on existing quotations are unchanged.`,
      details: {
        mode: 'update-live',
        added: Number(counts.added),
        changed: Number(counts.changed),
        removed: Number(counts.removed),
        itemCountBefore: activeCount,
        itemCountAfter: copied,
        appliedFromDraftId: draft.id,
      },
      performedBy: options.performedBy ?? null,
    });

    return {
      version: updated,
      changed: Number(counts.changed),
      added: Number(counts.added),
      removed: Number(counts.removed),
      itemCount: copied,
    };
  });
}

/**
 * Makes a previously published version live again.
 *
 * Only affects projects created from this point on. Projects already stamped with
 * another version keep it, so nothing a client has already seen moves.
 */
/**
 * Creates a project and stamps it with the live version in a single transaction.
 *
 * Reading the Active version and then inserting as two separate steps leaves a window
 * where a publish lands in between, stamping a brand new project with a version that has
 * just been superseded. Publishing takes this same advisory lock, so holding it here
 * makes the read-and-stamp atomic with respect to publishing.
 */
export async function createProjectWithActiveVersion(values: Record<string, any>): Promise<any> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(918273645)`);

    const [active] = await tx
      .select()
      .from(pricingVersions)
      .where(eq(pricingVersions.status, 'active'))
      .limit(1);

    if (!active) {
      throw new Error('NO_ACTIVE_PRICING_VERSION');
    }

    const [project] = await tx
      .insert(projects)
      .values({ ...values, pricingVersionId: active.id } as any)
      .returning();

    return project;
  });
}

export async function revertToVersion(versionId: string, performedBy?: string): Promise<PricingVersion> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(918273645)`);

    const [target] = await tx.select().from(pricingVersions).where(eq(pricingVersions.id, versionId)).limit(1);
    if (!target) throw new Error('That pricing version does not exist.');
    if (target.status === 'draft') throw new Error('The Draft cannot be made live directly — publish it instead.');
    if (target.status === 'active') return target;

    const [prevActive] = await tx.select().from(pricingVersions).where(eq(pricingVersions.status, 'active')).limit(1);
    if (prevActive) {
      await tx
        .update(pricingVersions)
        .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(pricingVersions.id, prevActive.id));
    }

    const [now] = await tx
      .update(pricingVersions)
      .set({ status: 'active', archivedAt: null, updatedAt: new Date() })
      .where(eq(pricingVersions.id, target.id))
      .returning();

    await tx.insert(pricingVersionAudit).values({
      versionId: now.id,
      action: 'revert',
      summary: `Reverted the live catalog to ${now.name}. New projects will use it; existing projects keep the version they were created with.`,
      details: { previousActive: prevActive ? { id: prevActive.id, name: prevActive.name } : null },
      performedBy: performedBy ?? null,
    });

    return now;
  });
}

// ------------------------------------------------- project catalog exceptions

/**
 * Grants one project access to a product that is not in the version it is pinned to.
 *
 * A published version is shared by every quotation pinned to it, so adding a product to
 * it would silently change what dozens of other quotations can be built from. This is
 * deliberately recorded against the single project instead: the product is offered to
 * that one quotation, priced from the version it is copied from, and nothing else moves.
 */
export async function addProjectCatalogException(input: {
  projectId: string;
  itemCode: string;
  sourceVersionId?: string;
  reason?: string | null;
  performedBy?: string;
}): Promise<{ itemCode: string; sourceVersionId: string; description: string | null }> {
  const itemCode = input.itemCode.trim();
  if (!itemCode) throw new Error('An item code is required.');

  return await db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new Error('That quotation does not exist.');
    if (!project.pricingVersionId) {
      throw new Error('That quotation is not pinned to a price list yet, so it has nothing to add to.');
    }

    let sourceId = input.sourceVersionId;
    if (!sourceId) {
      const [active] = await tx.select().from(pricingVersions).where(eq(pricingVersions.status, 'active')).limit(1);
      if (!active) throw new Error('There is no live price list to take the product from.');
      sourceId = active.id;
    }

    const [source] = await tx.select().from(pricingVersions).where(eq(pricingVersions.id, sourceId)).limit(1);
    if (!source) throw new Error('The price list to copy the product from does not exist.');
    if (source.status === 'draft') {
      throw new Error('A product cannot be taken from the Draft. Publish it first, then add it to the quotation.');
    }

    // Already in the quotation's own price list — nothing to grant.
    const [alreadyPriced] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(and(eq(catalogItems.pricingVersionId, project.pricingVersionId), eq(catalogItems.itemCode, itemCode)));
    if ((alreadyPriced?.n ?? 0) > 0) {
      throw new Error(`${itemCode} is already available on this quotation.`);
    }

    const [sourceItem] = await tx
      .select({ description: catalogItems.description, rate: catalogItems.rate, sellingPrice: catalogItems.sellingPrice })
      .from(catalogItems)
      .where(and(eq(catalogItems.pricingVersionId, sourceId), eq(catalogItems.itemCode, itemCode)))
      .limit(1);
    if (!sourceItem) throw new Error(`${itemCode} was not found in ${source.name}.`);

    const [existing] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(projectCatalogExceptions)
      .where(
        and(eq(projectCatalogExceptions.projectId, input.projectId), eq(projectCatalogExceptions.itemCode, itemCode))
      );
    if ((existing?.n ?? 0) > 0) {
      throw new Error(`${itemCode} has already been added to this quotation.`);
    }

    await tx.insert(projectCatalogExceptions).values({
      projectId: input.projectId,
      itemCode,
      sourceVersionId: sourceId,
      // Copied, not referenced: the live version's rows can be rewritten in place, so a
      // price looked up later is not necessarily the price that was granted here.
      grantedRate: sourceItem.rate ?? null,
      grantedSellingPrice: sourceItem.sellingPrice ?? null,
      reason: input.reason?.trim() || null,
      addedBy: input.performedBy ?? null,
    });

    await tx.insert(pricingVersionAudit).values({
      versionId: project.pricingVersionId,
      action: 'project_exception',
      itemCode,
      summary: `Made ${itemCode} available to the quotation for ${project.clientName}, priced from ${source.name}. No price list was modified and no other quotation was affected.`,
      details: { projectId: input.projectId, sourceVersionId: sourceId, reason: input.reason ?? null },
      performedBy: input.performedBy ?? null,
    });

    return { itemCode, sourceVersionId: sourceId, description: sourceItem.description ?? null };
  });
}

export async function removeProjectCatalogException(
  projectId: string,
  itemCode: string,
  performedBy?: string
): Promise<void> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error('That quotation does not exist.');

  const removed = await db
    .delete(projectCatalogExceptions)
    .where(and(eq(projectCatalogExceptions.projectId, projectId), eq(projectCatalogExceptions.itemCode, itemCode)))
    .returning({ id: projectCatalogExceptions.id });

  if (removed.length === 0) throw new Error(`${itemCode} is not one of this quotation's added products.`);

  await recordAudit({
    versionId: project.pricingVersionId,
    action: 'project_exception_removed',
    itemCode,
    summary: `Removed ${itemCode} from the quotation for ${project.clientName}. Lines already added to the quotation keep the price they were saved at.`,
    details: { projectId },
    performedBy,
  });
}

export interface ProjectCatalogExceptionRow {
  itemCode: string;
  description: string | null;
  categoryName: string | null;
  sellingPrice: number | null;
  sourceVersionName: string;
  reason: string | null;
  addedByName: string | null;
  createdAt: Date;
}

export async function listProjectCatalogExceptions(projectId: string): Promise<ProjectCatalogExceptionRow[]> {
  const res: any = await db.execute(sql`
    SELECT e.item_code,
           e.reason,
           e.created_at,
           v.name AS source_version_name,
           u.username AS added_by_name,
           ci.description,
           ci.category_name,
           ci.selling_price
    FROM project_catalog_exceptions e
    JOIN pricing_versions v ON v.id = e.source_version_id
    LEFT JOIN users u ON u.id = e.added_by
    LEFT JOIN LATERAL (
      SELECT description, category_name, selling_price
      FROM catalog_items
      WHERE pricing_version_id = e.source_version_id AND item_code = e.item_code
      LIMIT 1
    ) ci ON TRUE
    WHERE e.project_id = ${projectId}
    ORDER BY e.created_at DESC
  `);

  return ((res.rows ?? res) as any[]).map((r) => ({
    itemCode: r.item_code,
    description: r.description ?? null,
    categoryName: r.category_name ?? null,
    sellingPrice: r.selling_price ?? null,
    sourceVersionName: r.source_version_name,
    reason: r.reason ?? null,
    addedByName: r.added_by_name ?? null,
    createdAt: r.created_at,
  }));
}

export async function countVersionItems(versionId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, versionId));
  return row?.n ?? 0;
}
