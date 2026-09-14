/**
 * One-time initialisation of the pricing version engine.
 *
 * Adopts the catalog exactly as it stands today as V1 (Active), stamps every existing
 * project with it, and seeds a Draft working copy. Safe to run repeatedly.
 *
 * Prints before/after totals so it is obvious that nothing existing was altered.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { bootstrapPricingVersions, listVersions, getAllTabs } from "../server/pricing-versions";
import { confirmDatabaseTarget } from "./lib/db-target";

async function totals(label: string) {
  const r: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM projects)                                      AS projects,
      (SELECT COUNT(*) FROM line_items)                                    AS line_items,
      (SELECT COALESCE(SUM(amount),0)::bigint FROM line_items)             AS sum_amount,
      (SELECT COALESCE(SUM(rate),0)::bigint FROM line_items)               AS sum_rate,
      (SELECT COUNT(*) FROM catalog_items)                                 AS catalog_items,
      (SELECT COUNT(*) FROM catalog_items WHERE pricing_version_id IS NULL) AS unversioned_items,
      (SELECT COUNT(*) FROM projects WHERE pricing_version_id IS NULL)      AS unversioned_projects
  `);
  const row = (r.rows ?? r)[0];
  console.log(`\n[${label}]`);
  for (const [k, v] of Object.entries(row)) console.log(`  ${k.padEnd(22)} ${v}`);
  return row;
}

async function main() {
  await confirmDatabaseTarget("Bootstrap pricing versions");

  const before = await totals("BEFORE");

  const result = await bootstrapPricingVersions();
  console.log("\n[BOOTSTRAP]");
  for (const [k, v] of Object.entries(result)) console.log(`  ${k.padEnd(22)} ${v}`);

  const after = await totals("AFTER");

  console.log("\n[VERSIONS]");
  for (const v of await listVersions()) {
    console.log(`  #${v.versionNumber} ${v.name.padEnd(24)} ${v.status.padEnd(9)} items=${v.itemCount}`);
  }

  console.log("\n[TABS]");
  for (const t of await getAllTabs()) {
    console.log(
      `  gid=${String(t.sheetTabId).padEnd(11)} ${t.itemCodePrefix.padEnd(5)} ${t.layout.padEnd(15)} ${
        t.enabled ? "enabled " : "DISABLED"
      } ${JSON.stringify(t.tabTitle)}`
    );
  }

  // The only figures allowed to change are catalog_items (Draft copy added) and the
  // two "unversioned" counters. Anything touching existing quotes must be identical.
  console.log("\n[INVARIANTS]");
  const checks: Array<[string, boolean, string]> = [
    ["projects unchanged", before.projects === after.projects, `${before.projects} -> ${after.projects}`],
    ["line_items unchanged", before.line_items === after.line_items, `${before.line_items} -> ${after.line_items}`],
    ["sum(amount) unchanged", String(before.sum_amount) === String(after.sum_amount), `${before.sum_amount} -> ${after.sum_amount}`],
    ["sum(rate) unchanged", String(before.sum_rate) === String(after.sum_rate), `${before.sum_rate} -> ${after.sum_rate}`],
    ["all catalog items versioned", Number(after.unversioned_items) === 0, `${after.unversioned_items} left`],
    ["all projects versioned", Number(after.unversioned_projects) === 0, `${after.unversioned_projects} left`],
  ];
  let ok = true;
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "\nALL INVARIANTS HELD" : "\nINVARIANT VIOLATION");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
