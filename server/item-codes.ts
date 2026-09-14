/**
 * Item Code generation and sheet write-back.
 *
 * Item codes are the stable cross-version identity for a product. Without them the
 * only identity available is the sheet row number, which restarts in every tab and
 * shifts whenever a row is inserted or deleted — which would make a price diff report
 * hundreds of items as "changed" purely because rows moved.
 *
 * Placement: codes live in column N. The catalog parser reads A2:M, and the widest tab
 * uses columns A-K, so writing to N cannot disturb any value the parser reads and
 * cannot shift any existing column. This is deliberate — correctness over tidiness.
 *
 * Write safety, in order of importance:
 *   1. Only column N is ever written. No other cell is touched.
 *   2. A non-empty existing code is never overwritten.
 *   3. Every run can be previewed first, reporting exactly what it would write.
 *   4. Every write is recorded in the audit trail.
 */
import { getUncachableGoogleSheetClient } from "./google-sheets";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import { catalogSheetTabs, catalogItems, type CatalogSheetTab } from "@shared/schema";
import { formatItemCode, reserveItemCodes, ensureSequenceAtLeast, getEnabledTabs, recordAudit } from "./pricing-versions";

/** Column N — the first column safely beyond the A:M range the parser reads. */
export const ITEM_CODE_COLUMN = "N";
export const ITEM_CODE_COLUMN_INDEX = 13; // zero-based
export const ITEM_CODE_HEADER = "Item Code";
/** Grid must be at least this wide for column N to exist. */
const REQUIRED_COLUMN_COUNT = ITEM_CODE_COLUMN_INDEX + 1;

export interface TabCodePlan {
  sheetTabId: number;
  tabTitle: string;
  prefix: string;
  headerPresent: boolean;
  dataRows: number;
  alreadyCoded: number;
  toAssign: number;
  duplicateCodes: string[];
  malformedCodes: Array<{ row: number; value: string }>;
  gridNeedsWidening: boolean;
  /** rowNumber (1-based, as in the sheet) -> code to write */
  assignments: Array<{ rowNumber: number; code: string }>;
}

export interface ItemCodePreview {
  tabs: TabCodePlan[];
  totalToAssign: number;
  totalAlreadyCoded: number;
  totalDataRows: number;
}

function cellNonEmpty(v: any): boolean {
  return String(v ?? "").trim() !== "";
}

/**
 * A row counts as data if any cell in A:M carries content. This is deliberately
 * layout-independent: the meaningful columns differ per tab, and a row that the
 * catalog sync happens to skip today may be filled in later, at which point it should
 * already own a stable code.
 */
function isDataRow(row: any[] | undefined): boolean {
  if (!row) return false;
  return row.slice(0, 13).some(cellNonEmpty);
}

/**
 * Optional overrides, used to exercise the write path against a throwaway copy of the
 * spreadsheet before it is ever pointed at the live one.
 */
export interface ItemCodeOptions {
  /** Use these tabs instead of the configured ones (a backup copy has different gids). */
  tabsOverride?: CatalogSheetTab[];
  /** Suppress the audit record when running against a scratch spreadsheet. */
  skipAudit?: boolean;
}

/**
 * Builds the write plan for every enabled tab without modifying anything.
 */
export async function previewItemCodes(
  spreadsheetId: string,
  options: ItemCodeOptions = {}
): Promise<ItemCodePreview> {
  const sheets = await getUncachableGoogleSheetClient();
  const tabs = options.tabsOverride ?? (await getEnabledTabs());

  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const byGid = new Map<number, any>();
  for (const s of meta.data.sheets || []) byGid.set(s.properties!.sheetId!, s.properties);

  const plans: TabCodePlan[] = [];

  for (const tab of tabs) {
    const props = byGid.get(tab.sheetTabId);
    if (!props) {
      plans.push({
        sheetTabId: tab.sheetTabId,
        tabTitle: tab.tabTitle,
        prefix: tab.itemCodePrefix,
        headerPresent: false,
        dataRows: 0,
        alreadyCoded: 0,
        toAssign: 0,
        duplicateCodes: [],
        malformedCodes: [],
        gridNeedsWidening: false,
        assignments: [],
      });
      continue;
    }

    // Always address the tab by its live title resolved from the gid, never by the
    // stored title, so a rename cannot send a write to the wrong tab.
    const liveTitle: string = props.title;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${liveTitle}'!A1:N`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const values = res.data.values || [];
    const header = values[0] || [];
    const headerPresent =
      String(header[ITEM_CODE_COLUMN_INDEX] ?? "").trim().toLowerCase() === ITEM_CODE_HEADER.toLowerCase();

    const seen = new Map<string, number>();
    const duplicateCodes: string[] = [];
    const malformedCodes: Array<{ row: number; value: string }> = [];
    const needCode: number[] = [];
    let alreadyCoded = 0;
    let dataRows = 0;
    let maxSeq = 0;

    const codePattern = new RegExp(`^${tab.itemCodePrefix}-(\\d+)$`);

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!isDataRow(row)) continue;
      dataRows++;
      const rowNumber = i + 1; // sheet rows are 1-based
      const raw = String(row?.[ITEM_CODE_COLUMN_INDEX] ?? "").trim();

      if (raw === "") {
        needCode.push(rowNumber);
        continue;
      }

      alreadyCoded++;
      const m = raw.match(codePattern);
      if (!m) {
        malformedCodes.push({ row: rowNumber, value: raw });
      } else {
        maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      }
      if (seen.has(raw)) duplicateCodes.push(raw);
      else seen.set(raw, rowNumber);
    }

    // Never hand out a number that already exists in the sheet.
    if (maxSeq > 0) await ensureSequenceAtLeast(tab.itemCodePrefix, maxSeq + 1);

    // Preview only: peek at the counter without consuming it.
    const start = await reserveItemCodes(tab.itemCodePrefix, 0);
    const assignments = needCode.map((rowNumber, idx) => ({
      rowNumber,
      code: formatItemCode(tab.itemCodePrefix, start + idx),
    }));

    plans.push({
      sheetTabId: tab.sheetTabId,
      tabTitle: liveTitle,
      prefix: tab.itemCodePrefix,
      headerPresent,
      dataRows,
      alreadyCoded,
      toAssign: needCode.length,
      duplicateCodes: Array.from(new Set(duplicateCodes)),
      malformedCodes,
      gridNeedsWidening: (props.gridProperties?.columnCount ?? 0) < REQUIRED_COLUMN_COUNT,
      assignments,
    });
  }

  return {
    tabs: plans,
    totalToAssign: plans.reduce((a, p) => a + p.toAssign, 0),
    totalAlreadyCoded: plans.reduce((a, p) => a + p.alreadyCoded, 0),
    totalDataRows: plans.reduce((a, p) => a + p.dataRows, 0),
  };
}

export interface ItemCodeWriteResult {
  tabsWritten: number;
  codesWritten: number;
  perTab: Array<{ tabTitle: string; written: number; headerAdded: boolean; widened: boolean }>;
}

/**
 * Writes the missing item codes into the sheet.
 *
 * Only column N is written, existing codes are never overwritten, and each tab is
 * re-read immediately before writing so a concurrent edit cannot cause a stale plan to
 * clobber a code someone just typed.
 */
export async function generateItemCodes(
  spreadsheetId: string,
  performedBy?: string,
  options: ItemCodeOptions = {}
): Promise<ItemCodeWriteResult> {
  const sheets = await getUncachableGoogleSheetClient();
  const tabs = options.tabsOverride ?? (await getEnabledTabs());

  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const byGid = new Map<number, any>();
  for (const s of meta.data.sheets || []) byGid.set(s.properties!.sheetId!, s.properties);

  const perTab: ItemCodeWriteResult["perTab"] = [];
  let codesWritten = 0;
  let tabsWritten = 0;

  for (const tab of tabs) {
    const props = byGid.get(tab.sheetTabId);
    if (!props) continue;
    const liveTitle: string = props.title;

    // Widen the grid first if column N does not exist yet. This only appends empty
    // columns; no existing cell is affected.
    let widened = false;
    const columnCount = props.gridProperties?.columnCount ?? 0;
    if (columnCount < REQUIRED_COLUMN_COUNT) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              appendDimension: {
                sheetId: tab.sheetTabId,
                dimension: "COLUMNS",
                length: REQUIRED_COLUMN_COUNT - columnCount,
              },
            },
          ],
        },
      });
      widened = true;
    }

    // Re-read immediately before writing so the plan reflects the sheet as it is now.
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${liveTitle}'!A1:N`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const values = res.data.values || [];

    const header = values[0] || [];
    const headerPresent =
      String(header[ITEM_CODE_COLUMN_INDEX] ?? "").trim().toLowerCase() === ITEM_CODE_HEADER.toLowerCase();

    const codePattern = new RegExp(`^${tab.itemCodePrefix}-(\\d+)$`);
    let maxSeq = 0;
    const needCode: number[] = [];

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!isDataRow(row)) continue;
      const raw = String(row?.[ITEM_CODE_COLUMN_INDEX] ?? "").trim();
      if (raw === "") {
        needCode.push(i + 1);
      } else {
        const m = raw.match(codePattern);
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      }
    }

    if (maxSeq > 0) await ensureSequenceAtLeast(tab.itemCodePrefix, maxSeq + 1);

    const headerAdded = !headerPresent;
    if (needCode.length === 0 && headerPresent) {
      perTab.push({ tabTitle: liveTitle, written: 0, headerAdded: false, widened });
      continue;
    }

    // Reserve the block only now that we know exactly how many codes are needed.
    const start = needCode.length > 0 ? await reserveItemCodes(tab.itemCodePrefix, needCode.length) : 0;

    // Build one update per contiguous run of rows so a tab is written in as few
    // requests as possible while still only ever touching column N.
    const data: Array<{ range: string; values: any[][] }> = [];
    if (headerAdded) {
      data.push({
        range: `'${liveTitle}'!${ITEM_CODE_COLUMN}1`,
        values: [[ITEM_CODE_HEADER]],
      });
    }

    let runStart = -1;
    let run: string[][] = [];
    const flush = () => {
      if (runStart > 0 && run.length > 0) {
        data.push({ range: `'${liveTitle}'!${ITEM_CODE_COLUMN}${runStart}`, values: run });
      }
      runStart = -1;
      run = [];
    };

    let prevRow = -10;
    needCode.forEach((rowNumber, idx) => {
      const code = formatItemCode(tab.itemCodePrefix, start + idx);
      if (rowNumber !== prevRow + 1) {
        flush();
        runStart = rowNumber;
      }
      run.push([code]);
      prevRow = rowNumber;
    });
    flush();

    if (data.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      });
      tabsWritten++;
      codesWritten += needCode.length;
    }

    perTab.push({ tabTitle: liveTitle, written: needCode.length, headerAdded, widened });

    await db
      .update(catalogSheetTabs)
      .set({ tabTitle: liveTitle, updatedAt: new Date() })
      .where(eq(catalogSheetTabs.sheetTabId, tab.sheetTabId));
  }

  if (!options.skipAudit) {
    await recordAudit({
      action: "generate_item_codes",
      summary: `Wrote ${codesWritten} item codes into ${tabsWritten} sheet tabs (column ${ITEM_CODE_COLUMN} only).`,
      details: { perTab, column: ITEM_CODE_COLUMN },
      performedBy,
    });
  }

  return { tabsWritten, codesWritten, perTab };
}
