/**
 * Applies a SQL migration file to whichever database DATABASE_URL points at,
 * behind the production guard.
 *
 * Usage: npx tsx scripts/run-migration.ts migrations/0001_pricing_versions.sql
 */
import { readFileSync } from "fs";
import { pool } from "../server/db";
import { confirmDatabaseTarget } from "./lib/db-target";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: run-migration.ts <path-to-sql-file>");

  await confirmDatabaseTarget(`Apply migration: ${file}`);

  const sqlText = readFileSync(file, "utf8");
  console.log(`Applying ${file} (${sqlText.length} bytes)...`);

  const started = Date.now();
  // The file carries its own BEGIN/COMMIT, so it either applies whole or not at all.
  await pool.query(sqlText);
  console.log(`Applied in ${Date.now() - started}ms.`);

  process.exit(0);
}

main().catch((e) => {
  console.error("\nMIGRATION FAILED:", e.message);
  process.exit(1);
});
