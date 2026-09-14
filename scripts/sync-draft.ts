/** Syncs the live sheet into the Draft version and reports the outcome. */
import { syncCatalogToDraft } from "../server/catalog-sync";
import { confirmDatabaseTarget } from "./lib/db-target";

async function main() {
  await confirmDatabaseTarget("Sync sheet into Draft");

  const r = await syncCatalogToDraft(process.env.GOOGLE_SHEETS_ID!, {});
  console.log(`success=${r.success}  rows=${r.totalItems}  draftTotal=${r.draftTotalItems}  ${r.durationMs}ms`);
  console.log(`errors=${r.errorCount}  warnings=${r.warningCount}\n`);
  for (const t of r.syncedTabs) console.log(`  ${t.title.padEnd(28)} ${t.items}`);
  const errs = r.errors.filter((e) => e.severity === "error");
  if (errs.length) {
    console.log("\nERRORS:");
    for (const e of errs.slice(0, 10)) console.log(`  ${e.category} row ${e.row}: ${e.message}`);
  }
  const codeWarnings = r.errors.filter((e) => e.severity === "warning" && /Item Code/i.test(e.message));
  console.log(`\nitem-code warnings: ${codeWarnings.length}`);
  for (const e of codeWarnings.slice(0, 10)) console.log(`  ${e.category} row ${e.row}: ${e.message}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
