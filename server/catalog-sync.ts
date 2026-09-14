import { db } from './db';
import {
  catalogItems,
  catalogSyncLogs,
  pricingVersions,
  catalogSheetTabs,
  type InsertCatalogItem,
  type CatalogSheetTab,
} from '../shared/schema';
import { getUncachableGoogleSheetClient, parseMultiSelectCell, parseNumericValue } from './google-sheets';
import { eq, and, or, isNull, inArray, sql } from 'drizzle-orm';
import { getDraftVersion, recordAudit, assertVersionMutable, seedSheetTabs, ITEM_CODE_PAD } from './pricing-versions';
import { ITEM_CODE_COLUMN_INDEX } from './item-codes';

interface SyncError {
  row: number;
  category: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Normalizes a category name by collapsing multiple spaces and trimming
 */
export function normalizeCategory(category: string): string {
  return category.replace(/\s+/g, ' ').trim();
}

/**
 * Converts supported public image links into a URL an <img> element can load.
 * Images pasted directly into a cell are not exposed by the Sheets values API, so
 * Admins must use a URL in the image column. The host allowlist also prevents a Sheet
 * editor from making the PDF renderer request arbitrary/internal URLs.
 */
export function normalizeProductImageUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  if (parsed.hostname === 'drive.google.com') {
    const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    const fileId = pathMatch?.[1] || parsed.searchParams.get('id');
    if (fileId) {
      return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1200`;
    }
    return null;
  }

  if (parsed.hostname === 'd.imgvision.net') return parsed.toString();
  return null;
}

export interface SyncResult {
  success: boolean;
  syncLogId: string;
  draftVersionId: string;
  /**
   * The Draft's last-updated stamp immediately after this sync committed. A caller that
   * goes on to apply the Draft passes it back so the apply refuses if anything else has
   * rewritten the Draft in the meantime.
   */
  draftUpdatedAt: Date | null;
  totalItems: number;
  /** Items in the draft after the sync, across every tab (not just synced ones). */
  draftTotalItems: number;
  syncedTabs: Array<{ sheetTabId: number; title: string; items: number }>;
  categoryCounts: Record<string, number>;
  errorCount: number;
  warningCount: number;
  errors: SyncError[];
  durationMs: number;
}

/**
 * Advisory lock key shared by sync and publish.
 *
 * Sync and publish both rewrite whole swathes of the catalog. Without a lock two
 * admins acting at the same moment could interleave and produce a version that is half
 * old prices and half new. The lock is transaction-scoped, so it is released
 * automatically even if the operation throws.
 */
export const CATALOG_LOCK_KEY = 918273645;
const HANDLES_SHEET_TAB_ID = 1863704353;

export async function acquireCatalogLock(tx: any): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CATALOG_LOCK_KEY})`);
}

/**
 * Parses one tab's raw rows into catalog rows.
 *
 * The positional column mappings are preserved exactly as they were before pricing
 * versions were introduced; the only change is that the mapping is selected by the
 * tab's configured `layout` rather than by substring-matching its title. The four
 * layouts correspond one-to-one with the previous title checks:
 *
 *   lights          — price in column J, no room types
 *   services_stone  — price in column J
 *   accessories     — price in column K (column J is a unit, not a price)
 *   xpress_xpand    — price in column J, with markup/margin/selling price in K/L/M
 *   xclusive        — final selling price in column J
 *
 * Handles deliberately uses xpress_xpand: its price is in column J and columns K-M are
 * empty, which is exactly what that mapping expects.
 */
export function parseTabRows(
  tab: CatalogSheetTab,
  liveTitle: string,
  rows: any[][],
  ctx: { syncLogId: string | null; pricingVersionId: string },
  headers: any[] = []
): { items: InsertCatalogItem[]; errors: SyncError[] } {
  const items: InsertCatalogItem[] = [];
  const errors: SyncError[] = [];
  const seenCodes = new Map<string, number>();

  const layout = tab.layout;
  const imageColumnIndex = headers.findIndex((header) => {
    const normalized = String(header ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    return normalized.includes('image') || normalized.includes('imgae');
  });
  const normalizedHeaders = headers.map((header) => String(header ?? '').toLowerCase().replace(/\s+/g, ' ').trim());
  const headerIndex = (...names: string[]) => normalizedHeaders.findIndex((header) => names.includes(header));
  const requiredHeaders = tab.sheetTabId === HANDLES_SHEET_TAB_ID
    ? [['dimension'], ['brand'], ['product image', 'product imgae'], ['description'], ['rates', 'rate', 'selling value', 'selling price'], ['item code']]
    : layout === 'furniture'
      ? [['brand'], ['description'], ['unit'], ['mrp'], ['active']]
      : layout === 'appliances'
        ? [['brand'], ['description'], ['unit'], ['mrp']]
        : [];
  const missingHeaders = requiredHeaders
    .filter((aliases) => headerIndex(...aliases) < 0)
    .map((aliases) => aliases[0]);
  if (missingHeaders.length > 0) {
    return {
      items: [],
      errors: [{
        row: 0,
        category: liveTitle,
        message: `Required column(s) missing: ${missingHeaders.join(', ')}. Existing prices were left untouched.`,
        severity: 'error',
      }],
    };
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const actualRowNumber = rowIndex + 2; // data starts at A2

    try {
      if (!row || row.length === 0) continue;

      let projectType, section, roomTypeRaw, unitType, panelType, itemCategory;
      let materialType, brand, description;
      let rate, markup, markupValue, sellingPrice;
      let finishesOverride: string[] | null = null;

      let furnitureFields: Record<string, unknown> | null = null;
      if (tab.sheetTabId === HANDLES_SHEET_TAB_ID) {
        // Handles has its own header contract even though its historical tab metadata
        // uses the xpress_xpand layout. In particular, H is Product image, G is Brand,
        // J is the customer-facing rate, and N is Item Code.
        const valueAt = (...names: string[]) => {
          const index = headerIndex(...names);
          return index >= 0 ? row[index] : null;
        };
        projectType = valueAt('project type');
        section = valueAt('services type', 'section');
        roomTypeRaw = null;
        itemCategory = valueAt('work type');
        unitType = valueAt('product code', 'unit type');
        // The Handles source has these two headers reversed: the column labelled
        // Dimension contains 4G/Creatic/EBCO, while the column labelled Brand contains
        // 96mm/160mm/etc. Keep this explicit tab-specific correction until the Sheet
        // headers are repaired.
        brand = valueAt('dimension');
        panelType = valueAt('brand');
        materialType = valueAt('work type');
        finishesOverride = [...parseMultiSelectCell(valueAt('available finishes'))];
        description = valueAt('description');
        sellingPrice = valueAt('rates', 'rate', 'selling value', 'selling price');
        rate = sellingPrice;
        markup = undefined;
        markupValue = undefined;
      } else if (layout === 'furniture') {
        const valueAt = (...names: string[]) => {
          const index = headerIndex(...names);
          return index >= 0 ? row[index] : null;
        };
        const activeValue = valueAt('active');
        const isActive = activeValue === true || String(activeValue ?? '').trim().toLowerCase() === 'true';
        if (!isActive) continue;
        projectType = valueAt('project type');
        brand = valueAt('brand');
        const workType = valueAt('work type');
        section = workType;
        const applicableArea = valueAt('apllicable area', 'applicable area');
        const productCategory = valueAt('category');
        const subCategory = valueAt('sub category');
        const finishType = valueAt('finish type');
        const finishMaterial = valueAt('finish material');
        description = valueAt('description');
        const dimension = valueAt('dimension');
        const isChecked = (value: unknown) => value === true || String(value ?? '').trim().toLowerCase() === 'true';
        const requiresLength = isChecked(valueAt('requires length'));
        const requiresHeight = isChecked(valueAt('requires height'));
        const requiresDepth = isChecked(valueAt('requires depth'));
        unitType = valueAt('unit');
        sellingPrice = valueAt('mrp');
        panelType = applicableArea;
        materialType = finishMaterial;
        roomTypeRaw = null;
        rate = sellingPrice;
        markup = undefined;
        markupValue = undefined;
        furnitureFields = { applicableArea, productCategory, subCategory, finishType, dimension, requiresLength, requiresHeight, requiresDepth, isActive };
      } else if (layout === 'appliances') {
        // Appliances is intentionally header-driven. Its master sheet is maintained by
        // business users, so column placement must never decide a quotation's item,
        // price, or image.
        const valueAt = (...names: string[]) => {
          const index = headerIndex(...names);
          return index >= 0 ? row[index] : null;
        };
        projectType = valueAt('project type');
        brand = valueAt('brand');
        section = valueAt('work type');
        const productCategory = valueAt('category');
        const subCategory = valueAt('sub category');
        const dimension = valueAt('dimension');
        description = valueAt('description');
        unitType = valueAt('unit');
        sellingPrice = valueAt('mrp');
        panelType = productCategory;
        materialType = null;
        roomTypeRaw = null;
        rate = sellingPrice;
        markup = undefined;
        markupValue = undefined;
        furnitureFields = { productCategory, subCategory, dimension, isActive: true };
      } else if (layout === 'lights') {
        let workType, lightsCategory, applicableArea, units, images;
        [
          projectType,      // A - Project Type
          section,          // B - Services Type
          workType,         // C - Work Type
          lightsCategory,   // D - Category
          applicableArea,   // E - Applicable area
          brand,            // F - Brand
          units,            // G - Units
          images,           // H - Images (unused)
          description,      // I - Description
          sellingPrice,     // J - Rates (the price)
        ] = row;
        unitType = lightsCategory || workType;
        panelType = applicableArea;
        roomTypeRaw = null;
        materialType = units;
        rate = sellingPrice;
        markup = undefined;
        markupValue = undefined;
      } else if (layout === 'services_stone') {
        [
          projectType,      // A
          section,          // B
          roomTypeRaw,      // C
          unitType,         // D
          panelType,        // E
          itemCategory,     // F
          materialType,     // G
          brand,            // H
          description,      // I
          sellingPrice,     // J - the price
        ] = row;
        rate = sellingPrice;
        markup = undefined;
        markupValue = undefined;
      } else if (layout === 'xclusive') {
        [
          projectType,      // A
          section,          // B
          roomTypeRaw,      // C
          unitType,         // D
          panelType,        // E
          itemCategory,     // F
          materialType,     // G
          brand,            // H
          description,      // I
          sellingPrice,     // J - final selling value
        ] = row;
        rate = sellingPrice;
        markup = undefined;
        markupValue = undefined;
      } else if (layout === 'accessories') {
        [
          projectType,      // A
          section,          // B
          roomTypeRaw,      // C
          unitType,         // D
          panelType,        // E
          itemCategory,     // F
          materialType,     // G
          brand,            // H
          description,      // I
          ,                 // J - Unit (not a price)
          sellingPrice,     // K - the price
        ] = row;
        rate = sellingPrice;
        markup = undefined;
        markupValue = undefined;
      } else {
        // xpress_xpand
        [
          projectType,      // A
          section,          // B
          roomTypeRaw,      // C
          unitType,         // D
          panelType,        // E
          itemCategory,     // F
          materialType,     // G
          brand,            // H
          description,      // I
          rate,             // J
          markup,           // K
          markupValue,      // L
          sellingPrice,     // M
        ] = row;
      }

      // Rows the team cleared in the sheet come back as arrays of empty strings.
      if (!String(description ?? '').trim() && !String(unitType ?? '').trim()) continue;

      // ---- Item code: the stable cross-version identity -------------------------
      const itemCode = layout === 'furniture' || layout === 'appliances'
        ? `${tab.itemCodePrefix}-${String(actualRowNumber - 1).padStart(ITEM_CODE_PAD, '0')}`
        : String(row[ITEM_CODE_COLUMN_INDEX] ?? '').trim() || null;
      if (!itemCode) {
        errors.push({
          row: actualRowNumber,
          category: liveTitle,
          message: 'Row has no Item Code. Run "Generate Item Codes" so this item can be tracked across versions.',
          severity: 'warning',
        });
      } else {
        const codePattern = new RegExp(`^${tab.itemCodePrefix}-\\d{${ITEM_CODE_PAD},}$`);
        if (!codePattern.test(itemCode)) {
          errors.push({
            row: actualRowNumber,
            category: liveTitle,
            message: `Item Code "${itemCode}" does not match this tab's format (${tab.itemCodePrefix}-0000). It may have been edited by hand.`,
            severity: 'warning',
          });
        }
        const prev = seenCodes.get(itemCode);
        if (prev !== undefined) {
          errors.push({
            row: actualRowNumber,
            category: liveTitle,
            message: `Duplicate Item Code "${itemCode}" (also on row ${prev}). Prices for this item cannot be tracked reliably until the duplicate is resolved.`,
            severity: 'warning',
          });
        } else {
          seenCodes.set(itemCode, actualRowNumber);
        }
      }

      const normalizeRoomTypeValue = (val: string): 'Wet / Exposed' | 'Dry / Inexposed' | null => {
        const normalized = val.toLowerCase().trim();
        if (normalized.includes('dry') || normalized.includes('inexposed')) return 'Dry / Inexposed';
        if (normalized.includes('wet') || normalized.includes('exposed')) return 'Wet / Exposed';
        return null;
      };

      let roomTypes: Array<'Wet / Exposed' | 'Dry / Inexposed' | null> = [];
      if (roomTypeRaw && String(roomTypeRaw).toLowerCase().trim() !== 'room type') {
        const parts = String(roomTypeRaw).split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
        for (const part of parts) {
          const normalized = normalizeRoomTypeValue(part);
          if (normalized && !roomTypes.includes(normalized)) roomTypes.push(normalized);
        }
      }
      if (roomTypes.length === 0) roomTypes = [null];

      const materials: string[] = [...parseMultiSelectCell(materialType)];
      const brands: string[] = [...parseMultiSelectCell(brand)];
      const specifications: string[] = [...parseMultiSelectCell(panelType)];

      const parsedRate = parseNumericValue(rate, 0);
      const parsedMarkup = parseNumericValue(markup, 0);
      const parsedMargin = parseNumericValue(markupValue, 0);
      const parsedSellingPrice = parseNumericValue(sellingPrice, 0);
      const rawImageValue = imageColumnIndex >= 0 ? row[imageColumnIndex] : null;
      const imageUrl = normalizeProductImageUrl(rawImageValue);

      const rowWarnings: string[] = [];
      if (layout !== 'furniture' && layout !== 'appliances' && tab.sheetTabId !== HANDLES_SHEET_TAB_ID && roomTypes.length === 1 && !roomTypes[0]) rowWarnings.push('Room type is empty');
      if (roomTypes.length > 1) rowWarnings.push(`Multi-room-type item duplicated for: ${roomTypes.join(', ')}`);
      if (!unitType) rowWarnings.push('Unit type is empty');
      if (!description) rowWarnings.push('Description is empty');
      if (rawImageValue && !imageUrl) {
        rowWarnings.push('Image cell must contain a public HTTPS Google Drive or ImgVision image link');
      }

      // One catalog row per room type, so a multi-room item appears under both filters.
      // All copies share the same item code: the code identifies the sheet row.
      for (const rt of roomTypes) {
        items.push({
          sheetRowId: actualRowNumber,
          projectType: projectType || null,
          section: section || null,
          roomType: rt || null,
          roomTypeRaw: roomTypeRaw || null,
          unitType: unitType || null,
          unitTypeRaw: unitType || null,
          panelType: panelType || null,
          panelTypeRaw: panelType || null,
          categoryName: tab.categoryName,
          categoryNameRaw: liveTitle || null,
          materialType: materialType || null,
          materialTypeRaw: materialType || null,
          brand: brand || null,
          brandRaw: brand || null,
          description: description || null,
          rate: parsedRate,
          rateRaw: rate != null ? String(rate) : null,
          markup: parsedMarkup,
          markupRaw: markup != null ? String(markup) : null,
          margin: parsedMargin,
          marginRaw: markupValue != null ? String(markupValue) : null,
          sellingPrice: parsedSellingPrice,
          sellingPriceRaw: sellingPrice != null ? String(sellingPrice) : null,
          imageUrl,
          applicableArea: furnitureFields?.applicableArea ? String(furnitureFields.applicableArea) : null,
          productCategory: furnitureFields?.productCategory ? String(furnitureFields.productCategory) : null,
          subCategory: furnitureFields?.subCategory ? String(furnitureFields.subCategory) : null,
          finishType: furnitureFields?.finishType ? String(furnitureFields.finishType) : null,
          dimension: furnitureFields?.dimension ? String(furnitureFields.dimension) : null,
          requiresLength: furnitureFields?.requiresLength === true,
          requiresHeight: furnitureFields?.requiresHeight === true,
          requiresDepth: furnitureFields?.requiresDepth === true,
          isActive: furnitureFields?.isActive === false ? false : true,
          materials,
          finishes: finishesOverride ?? brands,
          specifications,
          itemType: tab.itemType as any,
          hasErrors: false,
          errorDetails: rowWarnings.length > 0 ? JSON.stringify({ warnings: rowWarnings }) : null,
          isValid: true,
          syncLogId: ctx.syncLogId,
          pricingVersionId: ctx.pricingVersionId,
          itemCode,
          sheetTabId: tab.sheetTabId,
        } as InsertCatalogItem);
      }

      if (rowWarnings.length > 0) {
        errors.push({
          row: actualRowNumber,
          category: liveTitle,
          message: rowWarnings.join('; '),
          severity: 'warning',
        });
      }
    } catch (rowError: any) {
      errors.push({
        row: actualRowNumber,
        category: liveTitle,
        message: `Failed to parse row: ${rowError.message}`,
        severity: 'error',
      });
    }
  }

  return { items, errors };
}

export async function getSyncLogs(limit: number = 10) {
  return db.select().from(catalogSyncLogs).orderBy(catalogSyncLogs.startedAt).limit(limit);
}

export interface DraftSyncOptions {
  /** Sync only these tabs (by stable gid). Omit to sync every enabled tab. */
  tabGids?: number[];
  userId?: string;
}

/**
 * Syncs the Google Sheet into the Draft version.
 *
 * This never creates a pricing version and never alters the Active version, so it can
 * be run as often as the team likes. Only an explicit Publish turns the Draft into a
 * version.
 *
 * Tabs are resolved by stable gid, never by title: the live spreadsheet contains two
 * tabs whose titles differ only by a trailing space, and title matching would silently
 * pick whichever came last in tab order.
 */
export async function syncCatalogToDraft(
  spreadsheetId: string,
  options: DraftSyncOptions = {}
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: SyncError[] = [];

  const draft = await getDraftVersion();
  if (!draft) {
    throw new Error('No Draft pricing version exists. Initialise pricing versions before syncing.');
  }

  // Pick up newly shipped canonical tabs without changing any existing admin-managed
  // tab configuration. This also makes a newly published tab available in production
  // on its first sync without a separate data migration.
  await seedSheetTabs();

  const configuredTabs = await db
    .select()
    .from(catalogSheetTabs)
    .where(eq(catalogSheetTabs.enabled, true))
    .orderBy(catalogSheetTabs.sortOrder);

  const tabs = options.tabGids?.length
    ? configuredTabs.filter((t) => options.tabGids!.includes(t.sheetTabId))
    : configuredTabs;

  if (tabs.length === 0) {
    throw new Error('No catalog tabs selected for sync.');
  }

  const sheets = await getUncachableGoogleSheetClient();

  const [syncLog] = await db
    .insert(catalogSyncLogs)
    .values({ userId: options.userId, status: 'in_progress', startedAt: new Date() })
    .returning();

  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const byGid = new Map<number, string>();
  for (const s of meta.data.sheets || []) byGid.set(s.properties!.sheetId!, s.properties!.title!);

  const allItems: InsertCatalogItem[] = [];
  const syncedTabs: SyncResult['syncedTabs'] = [];
  const categoryCounts: Record<string, number> = {};
  /** Tabs that were read without throwing — only these may have their rows replaced. */
  const fetchedGids: number[] = [];

  for (const tab of tabs) {
    const liveTitle = byGid.get(tab.sheetTabId);
    if (!liveTitle) {
      errors.push({
        row: 0,
        category: tab.tabTitle,
        message: `Tab "${tab.tabTitle}" (id ${tab.sheetTabId}) no longer exists in the spreadsheet. Its existing prices were left untouched.`,
        severity: 'error',
      });
      continue;
    }

    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        // A-M keep their established positional pricing meanings and N is Item Code.
        // Reading through Z lets an Admin append/move an Image column without a code
        // change; header detection above finds it without affecting those positions.
        range: `'${liveTitle}'!A1:Z`,
        // Preserve source prices precisely. The default formatted value can hide fractional
        // currency (for example, 34121.4 displays as 34121 in an integer-formatted cell).
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const [headers = [], ...rows] = res.data.values || [];
      if (rows.length === 0) {
        errors.push({
          row: 0,
          category: liveTitle,
          message: `Tab "${liveTitle}" is empty. Its existing prices were left untouched.`,
          severity: 'warning',
        });
        continue;
      }

      const parsed = parseTabRows(tab, liveTitle, rows, {
        syncLogId: syncLog.id,
        pricingVersionId: draft.id,
      }, headers);
      errors.push(...parsed.errors);
      if (parsed.errors.some((error) => error.severity === 'error' && error.row === 0)) {
        continue;
      }
      if (parsed.items.length === 0) {
        errors.push({
          row: 0,
          category: liveTitle,
          message: `Tab "${liveTitle}" contained rows but produced no catalog items. Its existing prices were left untouched.`,
          severity: 'error',
        });
        continue;
      }
      allItems.push(...parsed.items);
      fetchedGids.push(tab.sheetTabId);
      syncedTabs.push({ sheetTabId: tab.sheetTabId, title: liveTitle, items: parsed.items.length });
      categoryCounts[tab.categoryName] = parsed.items.length;

      if (liveTitle !== tab.tabTitle) {
        await db
          .update(catalogSheetTabs)
          .set({ tabTitle: liveTitle, updatedAt: new Date() })
          .where(eq(catalogSheetTabs.sheetTabId, tab.sheetTabId));
      }
    } catch (tabError: any) {
      errors.push({
        row: 0,
        category: liveTitle,
        message: `Failed to read tab: ${tabError.message}. Its existing prices were left untouched.`,
        severity: 'error',
      });
    }
  }

  // Safety guard, preserved from the original sync: if nothing at all came back the
  // connection is probably broken, so abort without touching stored prices.
  if (allItems.length === 0) {
    const durationMs = Date.now() - startTime;
    await db
      .update(catalogSyncLogs)
      .set({
        status: 'failed',
        totalItems: 0,
        errorCount: errors.filter((e) => e.severity === 'error').length + 1,
        warningCount: errors.filter((e) => e.severity === 'warning').length,
        errorSummary: JSON.stringify([
          ...errors.slice(0, 99),
          {
            row: 0,
            category: 'all',
            message: 'Sync aborted: no rows fetched from Google Sheets. Existing prices were preserved.',
            severity: 'error',
          },
        ]),
        durationMs,
        completedAt: new Date(),
      })
      .where(eq(catalogSyncLogs.id, syncLog.id));
    throw new Error(
      'Sync aborted: no rows were fetched from Google Sheets. Nothing was changed. Please check the connection and try again.'
    );
  }

  // Replace only the tabs that were read successfully, inside one transaction, so the
  // draft can never be left half-written.
  await db.transaction(async (tx) => {
    await acquireCatalogLock(tx);

    // The Draft was resolved before the sheet was read, which takes seconds. A publish
    // in that window promotes the Draft into an immutable published version, and writing
    // these rows into it would reprice every project stamped to it. Re-check identity now
    // that the lock is held, and abandon the write if it moved.
    try {
      await assertVersionMutable(tx, draft.id, 'Syncing the sheet');
    } catch {
      throw new Error(
        'The Draft was published while this sync was running, so nothing was written. Run the sync again to load the sheet into the new Draft.'
      );
    }

    // Replace the synced tabs' rows only. Rows carried over from before pricing
    // versions existed have no sheet_tab_id yet, so they are matched by category as
    // well — otherwise the first sync would leave a stale duplicate of every item
    // sitting alongside the freshly synced one.
    const fetchedCategories = tabs
      .filter((t) => fetchedGids.includes(t.sheetTabId))
      .map((t) => t.categoryName);

    await tx
      .delete(catalogItems)
      .where(
        and(
          eq(catalogItems.pricingVersionId, draft.id),
          or(
            inArray(catalogItems.sheetTabId, fetchedGids),
            and(isNull(catalogItems.sheetTabId), inArray(catalogItems.categoryName, fetchedCategories))
          )
        )
      );

    const CHUNK = 500;
    for (let i = 0; i < allItems.length; i += CHUNK) {
      await tx.insert(catalogItems).values(allItems.slice(i, i + CHUNK) as any);
    }

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(eq(catalogItems.pricingVersionId, draft.id));

    await tx
      .update(pricingVersions)
      .set({ itemCount: n, updatedAt: new Date() })
      .where(eq(pricingVersions.id, draft.id));
  });

  const [{ draftTotal }] = await db
    .select({ draftTotal: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, draft.id));

  const [draftAfter] = await db
    .select({ updatedAt: pricingVersions.updatedAt })
    .from(pricingVersions)
    .where(eq(pricingVersions.id, draft.id))
    .limit(1);

  const durationMs = Date.now() - startTime;
  const errorCount = errors.filter((e) => e.severity === 'error').length;
  const warningCount = errors.filter((e) => e.severity === 'warning').length;

  await db
    .update(catalogSyncLogs)
    .set({
      status: errorCount > 0 ? 'partial' : 'success',
      xpressCount: categoryCounts['DeX - Xpress'] ?? 0,
      xpandCount: categoryCounts['DeX - Xpand'] ?? 0,
      xclusiveCount: categoryCounts['DeX - Xclusive'] ?? 0,
      accessoriesCount: categoryCounts['DeX - Accessories'] ?? 0,
      servicesCount: categoryCounts['DeX - Services'] ?? 0,
      lightsCount: categoryCounts['DeX - Lights'] ?? 0,
      stoneMasterCount: categoryCounts['DeX - Stone Master'] ?? 0,
      handlesCount: categoryCounts['DeX - Handles'] ?? 0,
      economyCount: 0,
      litePremiumCount: 0,
      premiumCount: 0,
      luxuryCount: 0,
      totalItems: allItems.length,
      errorCount,
      warningCount,
      errorSummary: errors.length > 0 ? JSON.stringify(errors.slice(0, 100)) : null,
      durationMs,
      completedAt: new Date(),
    })
    .where(eq(catalogSyncLogs.id, syncLog.id));

  await recordAudit({
    versionId: draft.id,
    action: 'sync_draft',
    summary: `Synced ${syncedTabs.length} tab(s) into the Draft — ${allItems.length} rows. No pricing version was created.`,
    details: { syncedTabs, errorCount, warningCount },
    performedBy: options.userId,
  });

  return {
    success: errorCount === 0,
    syncLogId: syncLog.id,
    draftVersionId: draft.id,
    draftUpdatedAt: draftAfter?.updatedAt ?? null,
    totalItems: allItems.length,
    draftTotalItems: draftTotal,
    syncedTabs,
    categoryCounts,
    errorCount,
    warningCount,
    errors,
    durationMs,
  };
}
