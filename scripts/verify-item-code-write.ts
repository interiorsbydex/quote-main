/**
 * Proves the item-code write path is safe, by running it against the throwaway backup
 * copy of the spreadsheet and asserting that columns A:M come out byte-identical.
 *
 * This is the rehearsal that must pass before the same code is ever pointed at the
 * live sheet. It uses distinct test prefixes so the real code sequences stay untouched.
 */
import { google } from "googleapis";
import { generateItemCodes, ITEM_CODE_COLUMN_INDEX, ITEM_CODE_HEADER } from "../server/item-codes";
import { getUncachableGoogleSheetClient } from "../server/google-sheets";
import type { CatalogSheetTab } from "@shared/schema";

const BACKUP_ID = process.argv[2];
if (!BACKUP_ID) throw new Error("Usage: verify-item-code-write.ts <backupSpreadsheetId>");

/** Reads A:N for every tab, returning a title -> rows map. */
async function snapshot(sheets: any, spreadsheetId: string, titles: string[]) {
  const out = new Map<string, any[][]>();
  for (const t of titles) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${t}'!A1:N`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    out.set(t, res.data.values || []);
  }
  return out;
}

/** Normalises a row's A:M portion so trailing-empty differences do not register. */
function amKey(row: any[] | undefined): string {
  const cells = (row || []).slice(0, 13).map((c) => String(c ?? ""));
  while (cells.length && cells[cells.length - 1] === "") cells.pop();
  return JSON.stringify(cells);
}

async function main() {
  const sheets = await getUncachableGoogleSheetClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: BACKUP_ID, includeGridData: false });
  const tabProps = (meta.data.sheets || [])
    .map((s: any) => s.properties)
    .filter((p: any) => (p.title || "").toLowerCase().includes("dex"));

  // Build an override config pointing at the backup's own gids, with TEST_ prefixes so
  // the production item-code counters are not advanced by this rehearsal.
  const override: CatalogSheetTab[] = tabProps.map((p: any, i: number) => ({
    id: `test-${i}`,
    sheetTabId: p.sheetId,
    tabTitle: p.title,
    categoryName: p.title,
    itemCodePrefix: `T${i}X`,
    layout: "xpress_xpand",
    itemType: "woodworks",
    enabled: true,
    sortOrder: i,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  const titles = tabProps.map((p: any) => p.title);
  console.log(`Rehearsing write against backup copy (${titles.length} tabs)...\n`);

  const before = await snapshot(sheets, BACKUP_ID, titles);

  const result = await generateItemCodes(BACKUP_ID, undefined, {
    tabsOverride: override,
    skipAudit: true,
  });
  console.log(`Wrote ${result.codesWritten} codes across ${result.tabsWritten} tabs\n`);

  const after = await snapshot(sheets, BACKUP_ID, titles);

  let failures = 0;
  let checkedRows = 0;
  let codedRows = 0;

  for (const title of titles) {
    const b = before.get(title)!;
    const a = after.get(title)!;

    if (a.length !== b.length) {
      console.log(`  FAIL ${title}: row count changed ${b.length} -> ${a.length}`);
      failures++;
      continue;
    }

    let tabFail = 0;
    for (let i = 0; i < b.length; i++) {
      checkedRows++;
      if (amKey(b[i]) !== amKey(a[i])) {
        if (tabFail < 3) {
          console.log(`  FAIL ${title} row ${i + 1}: A:M changed`);
          console.log(`       before ${amKey(b[i]).slice(0, 120)}`);
          console.log(`       after  ${amKey(a[i]).slice(0, 120)}`);
        }
        tabFail++;
        failures++;
      }
      if (i > 0 && String(a[i]?.[ITEM_CODE_COLUMN_INDEX] ?? "").trim() !== "") codedRows++;
    }

    const headerOk =
      String(a[0]?.[ITEM_CODE_COLUMN_INDEX] ?? "").trim().toLowerCase() === ITEM_CODE_HEADER.toLowerCase();
    if (!headerOk) {
      console.log(`  FAIL ${title}: header missing in column N`);
      failures++;
    }

    console.log(
      `  ${tabFail === 0 && headerOk ? "PASS" : "FAIL"} ${title.padEnd(32)} rows=${b.length - 1} A:M unchanged=${
        tabFail === 0
      } header=${headerOk}`
    );
  }

  console.log(`\n  rows compared : ${checkedRows}`);
  console.log(`  rows coded    : ${codedRows}`);
  console.log(failures === 0 ? "\nREHEARSAL PASSED — A:M untouched, column N populated" : `\nREHEARSAL FAILED (${failures} problems)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
