/**
 * Verifies the live spreadsheet's data columns are unchanged after the item-code write,
 * by comparing A:M against the local raw snapshot captured before any write occurred.
 *
 *   npx tsx scripts/verify-live-sheet.ts backups/sheet-<timestamp>
 */
import * as fs from "fs";
import * as path from "path";
import { getUncachableGoogleSheetClient } from "../server/google-sheets";
import { ITEM_CODE_COLUMN_INDEX, ITEM_CODE_HEADER } from "../server/item-codes";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: verify-live-sheet.ts <backupDir>");

function amKey(row: any[] | undefined): string {
  const cells = (row || []).slice(0, 13).map((c) => String(c ?? ""));
  while (cells.length && cells[cells.length - 1] === "") cells.pop();
  return JSON.stringify(cells);
}

async function main() {
  const sheets = await getUncachableGoogleSheetClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  let failures = 0;
  let compared = 0;
  let coded = 0;

  for (const f of files) {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const { title, values: before } = snap as { title: string; values: any[][] };

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title}'!A1:N`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const after = res.data.values || [];

    let tabFail = 0;
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) {
      compared++;
      if (amKey(before[i]) !== amKey(after[i])) {
        if (tabFail < 3) {
          console.log(`  FAIL ${title} row ${i + 1}`);
          console.log(`       before ${amKey(before[i]).slice(0, 140)}`);
          console.log(`       after  ${amKey(after[i]).slice(0, 140)}`);
        }
        tabFail++;
        failures++;
      }
      if (i > 0 && String(after[i]?.[ITEM_CODE_COLUMN_INDEX] ?? "").trim() !== "") coded++;
    }

    const headerOk =
      String(after[0]?.[ITEM_CODE_COLUMN_INDEX] ?? "").trim().toLowerCase() === ITEM_CODE_HEADER.toLowerCase();

    console.log(
      `  ${tabFail === 0 ? "PASS" : "FAIL"} ${title.padEnd(30)} A:M unchanged=${tabFail === 0} itemCodeHeader=${headerOk}`
    );
  }

  console.log(`\n  rows compared : ${compared}`);
  console.log(`  rows coded    : ${coded}`);
  console.log(failures === 0 ? "\nLIVE SHEET VERIFIED — no data column was altered" : `\nVERIFICATION FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
