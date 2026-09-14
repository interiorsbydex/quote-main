/**
 * Item code preview / write CLI.
 *
 *   npx tsx scripts/item-codes.ts preview   -> reports exactly what would be written
 *   npx tsx scripts/item-codes.ts write     -> writes codes into column N of each tab
 */
import { previewItemCodes, generateItemCodes } from "../server/item-codes";

async function main() {
  const mode = process.argv[2] || "preview";
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_ID not set");

  if (mode === "preview") {
    const p = await previewItemCodes(spreadsheetId);
    console.log("PREVIEW — nothing has been written\n");
    console.log(
      "  tab".padEnd(28) + "prefix".padEnd(8) + "rows".padEnd(7) + "coded".padEnd(7) + "to add".padEnd(8) + "header  grid"
    );
    for (const t of p.tabs) {
      console.log(
        `  ${t.tabTitle.padEnd(26)}${t.prefix.padEnd(8)}${String(t.dataRows).padEnd(7)}${String(t.alreadyCoded).padEnd(
          7
        )}${String(t.toAssign).padEnd(8)}${(t.headerPresent ? "ok" : "ADD").padEnd(8)}${
          t.gridNeedsWidening ? "WIDEN" : "ok"
        }`
      );
      if (t.duplicateCodes.length) console.log(`      duplicate codes: ${t.duplicateCodes.join(", ")}`);
      if (t.malformedCodes.length)
        console.log(
          `      malformed codes: ${t.malformedCodes.slice(0, 5).map((m) => `row ${m.row}="${m.value}"`).join(", ")}${
            t.malformedCodes.length > 5 ? ` (+${t.malformedCodes.length - 5} more)` : ""
          }`
        );
      if (t.assignments.length) {
        const first = t.assignments[0], last = t.assignments[t.assignments.length - 1];
        console.log(`      will assign ${first.code} (row ${first.rowNumber}) .. ${last.code} (row ${last.rowNumber})`);
      }
    }
    console.log(`\n  TOTAL data rows: ${p.totalDataRows}`);
    console.log(`  TOTAL already coded: ${p.totalAlreadyCoded}`);
    console.log(`  TOTAL to assign: ${p.totalToAssign}`);
    return;
  }

  if (mode === "write") {
    const r = await generateItemCodes(spreadsheetId);
    console.log(`Wrote ${r.codesWritten} codes across ${r.tabsWritten} tabs\n`);
    for (const t of r.perTab) {
      console.log(
        `  ${t.tabTitle.padEnd(28)} written=${String(t.written).padEnd(6)}${t.headerAdded ? " header-added" : ""}${
          t.widened ? " grid-widened" : ""
        }`
      );
    }
    return;
  }

  throw new Error(`Unknown mode "${mode}". Use "preview" or "write".`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
