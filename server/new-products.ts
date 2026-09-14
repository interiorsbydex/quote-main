import { and, eq, inArray, sql } from "drizzle-orm";
import {
  catalogItems,
  catalogSheetTabs,
  pricingVersionAudit,
  pricingVersions,
  type CatalogSheetTab,
  type InsertCatalogItem,
} from "@shared/schema";
import { db } from "./db";
import { getUncachableGoogleSheetClient } from "./google-sheets";
import { parseTabRows } from "./catalog-sync";
import {
  ensureSequenceAtLeast,
  formatItemCode,
  ITEM_CODE_PAD,
  reserveItemCodes,
} from "./pricing-versions";

const DISABLED_LEGACY_SERVICES_GID = 13396685;
const ITEM_CODE_INDEX = 13;

export interface NewProductDestination {
  versionId: string;
  price: number;
}

export interface AddNewProductInput {
  sheetTabId: number;
  itemCode?: string;
  cells: Record<string, string>;
  destinations: NewProductDestination[];
  performedBy: string;
}

export interface NewProductTabOption {
  sheetTabId: number;
  tabTitle: string;
  categoryName: string;
  itemCodePrefix: string;
  layout: string;
  headers: Array<{ index: number; column: string; label: string }>;
  priceColumn: { index: number; column: string; label: string };
}

function columnName(index: number): string {
  return String.fromCharCode(65 + index);
}

function priceColumnIndex(tab: CatalogSheetTab): number {
  return tab.layout === "accessories" ? 10 : 9;
}

function applyPriceToRow(row: any[], tab: CatalogSheetTab, price: number): void {
  row[priceColumnIndex(tab)] = price;
  // The Xpress/Xpand parser treats J as rate and M as final selling price. The live
  // header currently labels J while M is blank, but normal Sheet sync still reads both
  // positions. Writing both keeps this one-price Admin flow stable after the next sync.
  if (tab.layout === "xpress_xpand") row[12] = price;
}

async function loadLiveTab(
  spreadsheetId: string,
  tab: CatalogSheetTab
): Promise<{ title: string; headers: string[]; values: any[][] }> {
  const sheets = await getUncachableGoogleSheetClient();
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const properties = (metadata.data.sheets || [])
    .map((sheet) => sheet.properties)
    .find((property) => property?.sheetId === tab.sheetTabId);
  if (!properties?.title) throw new Error(`The configured Sheet tab for ${tab.categoryName} was not found.`);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${properties.title.replace(/'/g, "''")}'!A1:N`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values = (response.data.values || []) as any[][];
  return {
    title: properties.title,
    headers: (values[0] || []).map((value) => String(value ?? "").trim()),
    values,
  };
}

export async function getNewProductOptions(spreadsheetId: string) {
  const tabs = await db
    .select()
    .from(catalogSheetTabs)
    .where(and(eq(catalogSheetTabs.enabled, true), sql`${catalogSheetTabs.sheetTabId} <> ${DISABLED_LEGACY_SERVICES_GID}`))
    .orderBy(catalogSheetTabs.sortOrder);
  const versions = await db.select().from(pricingVersions).orderBy(pricingVersions.versionNumber);

  const tabOptions: NewProductTabOption[] = [];
  for (const tab of tabs) {
    const live = await loadLiveTab(spreadsheetId, tab);
    const priceIndex = priceColumnIndex(tab);
    const fields = live.headers
      .map((label, index) => ({ index, column: columnName(index), label }))
      .filter((field) => field.index !== priceIndex && field.index !== ITEM_CODE_INDEX && !!field.label);
    tabOptions.push({
      sheetTabId: tab.sheetTabId,
      tabTitle: live.title,
      categoryName: tab.categoryName,
      itemCodePrefix: tab.itemCodePrefix,
      layout: tab.layout,
      headers: fields,
      priceColumn: {
        index: priceIndex,
        column: columnName(priceIndex),
        label: live.headers[priceIndex] || "Price",
      },
    });
  }

  return {
    tabs: tabOptions,
    versions: versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      name: version.name,
      status: version.status,
      itemCount: version.itemCount,
    })),
  };
}

function normalizeCells(input: Record<string, string>): Record<number, string> {
  const cells: Record<number, string> = {};
  for (const [key, value] of Object.entries(input || {})) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < ITEM_CODE_INDEX) {
      cells[index] = String(value ?? "").trim();
    }
  }
  return cells;
}

export async function addNewProduct(spreadsheetId: string, input: AddNewProductInput) {
  const tabId = Number(input.sheetTabId);
  if (!Number.isInteger(tabId) || tabId === DISABLED_LEGACY_SERVICES_GID) {
    throw new Error("Choose an enabled catalog tab.");
  }
  if (!Array.isArray(input.destinations) || input.destinations.length === 0) {
    throw new Error("Select at least one destination version.");
  }

  const [tab] = await db
    .select()
    .from(catalogSheetTabs)
    .where(and(eq(catalogSheetTabs.sheetTabId, tabId), eq(catalogSheetTabs.enabled, true)))
    .limit(1);
  if (!tab || tab.sheetTabId === DISABLED_LEGACY_SERVICES_GID) {
    throw new Error("That catalog tab is disabled and cannot receive products.");
  }

  const cells = normalizeCells(input.cells);
  if (!cells[8]) throw new Error("Description is required.");

  const destinationIds = Array.from(new Set(input.destinations.map((destination) => String(destination.versionId))));
  if (destinationIds.length !== input.destinations.length) throw new Error("Each destination version can be selected only once.");
  const priceByVersion = new Map<string, number>();
  for (const destination of input.destinations) {
    const price = Number(destination.price);
    if (!Number.isFinite(price) || price < 0) throw new Error("Every selected version needs a valid non-negative price.");
    priceByVersion.set(String(destination.versionId), price);
  }

  const selectedVersions = await db
    .select()
    .from(pricingVersions)
    .where(inArray(pricingVersions.id, destinationIds));
  if (selectedVersions.length !== destinationIds.length) throw new Error("One or more selected versions no longer exist.");

  const liveTab = await loadLiveTab(spreadsheetId, tab);
  const existingSheetCodes = new Set(
    liveTab.values.slice(1).map((row) => String(row?.[ITEM_CODE_INDEX] ?? "").trim()).filter(Boolean)
  );
  const pattern = new RegExp(`^${tab.itemCodePrefix}-(\\d{${ITEM_CODE_PAD},})$`);

  let itemCode = String(input.itemCode ?? "").trim().toUpperCase();
  if (itemCode) {
    if (!pattern.test(itemCode)) throw new Error(`Item Code must use the format ${tab.itemCodePrefix}-0000.`);
  } else {
    let maxSheetSequence = 0;
    for (const code of Array.from(existingSheetCodes)) {
      const match = code.match(pattern);
      if (match) maxSheetSequence = Math.max(maxSheetSequence, Number(match[1]));
    }
    await ensureSequenceAtLeast(tab.itemCodePrefix, maxSheetSequence + 1);
    const reserved = await reserveItemCodes(tab.itemCodePrefix, 1);
    itemCode = formatItemCode(tab.itemCodePrefix, reserved);
  }

  if (existingSheetCodes.has(itemCode)) throw new Error(`${itemCode} already exists in the Google Sheet.`);

  const [existingDatabaseItem] = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(eq(catalogItems.itemCode, itemCode))
    .limit(1);
  if (existingDatabaseItem) throw new Error(`${itemCode} already exists in a catalog snapshot.`);

  const priceIndex = priceColumnIndex(tab);
  const draftDestination = selectedVersions.find((version) => version.status === "draft");
  const sheets = draftDestination ? await getUncachableGoogleSheetClient() : null;
  let appendedRange: string | null = null;
  let appendedSheetRowId: number | null = null;

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(918273645)`);

      const [duplicate] = await tx
        .select({ id: catalogItems.id })
        .from(catalogItems)
        .where(eq(catalogItems.itemCode, itemCode))
        .limit(1);
      if (duplicate) throw new Error(`${itemCode} was added by someone else. Choose another code.`);

      let sheetRowId: number | null = null;
      if (draftDestination && sheets) {
        const sheetRow: any[] = Array.from({ length: 14 }, () => "");
        for (const [index, value] of Object.entries(cells)) sheetRow[Number(index)] = value;
        applyPriceToRow(sheetRow, tab, priceByVersion.get(draftDestination.id)!);
        sheetRow[ITEM_CODE_INDEX] = itemCode;
        const appended = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${liveTab.title.replace(/'/g, "''")}'!A:N`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [sheetRow] },
        });
        appendedRange = appended.data.updates?.updatedRange ?? null;
        const rowMatch = appendedRange?.match(/(?:!|^)[A-Z]+(\d+)(?::|$)/);
        sheetRowId = rowMatch ? Number(rowMatch[1]) : null;
        appendedSheetRowId = sheetRowId;
      }

      const insertedByVersion: Array<{ id: string; name: string; status: string; price: number; rows: number }> = [];
      for (const version of selectedVersions) {
        const price = priceByVersion.get(version.id)!;
        const row: any[] = Array.from({ length: 14 }, () => "");
        for (const [index, value] of Object.entries(cells)) row[Number(index)] = value;
        applyPriceToRow(row, tab, price);
        row[ITEM_CODE_INDEX] = itemCode;

        const parsed = parseTabRows(
          tab,
          liveTab.title,
          [row],
          { syncLogId: null, pricingVersionId: version.id },
          liveTab.headers
        );
        const hardErrors = parsed.errors.filter((error) => error.severity === "error");
        if (hardErrors.length > 0 || parsed.items.length === 0) {
          throw new Error(hardErrors[0]?.message || "The product could not be converted into a catalog row.");
        }

        const values: InsertCatalogItem[] = parsed.items.map((item) => ({
          ...item,
          sheetRowId,
          rate: price,
          rateRaw: String(price),
          sellingPrice: price,
          sellingPriceRaw: String(price),
          createdBy: input.performedBy,
          isBackported: version.status !== "draft",
          backportedFromVersionId: draftDestination?.id ?? null,
          backportedBy: version.status !== "draft" ? input.performedBy : null,
          backportedAt: version.status !== "draft" ? new Date() : null,
        }));
        await tx.insert(catalogItems).values(values as any[]);
        await tx
          .update(pricingVersions)
          .set({
            itemCount: sql`(SELECT count(*)::int FROM catalog_items WHERE pricing_version_id = ${version.id})`,
            updatedAt: new Date(),
          })
          .where(eq(pricingVersions.id, version.id));
        insertedByVersion.push({
          id: version.id,
          name: version.name,
          status: version.status,
          price,
          rows: values.length,
        });
      }

      await tx.insert(pricingVersionAudit).values({
        versionId: draftDestination?.id ?? selectedVersions[0].id,
        action: "add_new_product",
        itemCode,
        summary: `Added ${itemCode} to ${selectedVersions.length} selected catalog version(s): ${selectedVersions.map((version) => version.name).join(", ")}.`,
        details: {
          sheetTabId: tab.sheetTabId,
          sheetTabTitle: liveTab.title,
          destinations: insertedByVersion,
          sheetAppended: !!draftDestination,
          sheetRange: appendedRange,
        },
        performedBy: input.performedBy,
      });

      return { insertedByVersion, sheetRowId };
    });

    return {
      itemCode,
      tab: { sheetTabId: tab.sheetTabId, title: liveTab.title, categoryName: tab.categoryName },
      destinations: result.insertedByVersion,
      sheetAppended: !!draftDestination,
      sheetRowId: result.sheetRowId,
      sheetRange: appendedRange,
    };
  } catch (error) {
    if (appendedRange && sheets) {
      try {
        if (appendedSheetRowId) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{
                deleteDimension: {
                  range: {
                    sheetId: tab.sheetTabId,
                    dimension: "ROWS",
                    startIndex: appendedSheetRowId - 1,
                    endIndex: appendedSheetRowId,
                  },
                },
              }],
            },
          });
        } else {
          // Last-resort reconciliation when Google returns an unexpected updatedRange
          // shape: clear only the row this request appended, never pre-existing values.
          await sheets.spreadsheets.values.clear({ spreadsheetId, range: appendedRange });
        }
      } catch (rollbackError) {
        console.error("Failed to remove the newly appended Sheet row after database rollback:", rollbackError);
      }
    }
    throw error;
  }
}