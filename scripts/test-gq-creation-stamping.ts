/**
 * The GQ-sheet admin route is the creation path that was missing its pricing version.
 * This exercises the real function that route calls, end to end against the real sheet,
 * and confirms the quotation it produces is pinned to the live version. The quotation it
 * creates is deleted again afterwards.
 *
 * Development only.
 *
 * Usage: EXPECT_DB=development npx tsx scripts/test-gq-creation-stamping.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { projects, users } from "../shared/schema";
import { createGQ1Project } from "../server/create-gq1-project";
import { getActiveVersion } from "../server/pricing-versions";
import { confirmDatabaseTarget } from "./lib/db-target";

const SPREADSHEET_ID = process.env.GQ_SPREADSHEET_ID || process.env.SPREADSHEET_ID;

async function main() {
  await confirmDatabaseTarget("test-gq-creation-stamping");

  if (!SPREADSHEET_ID) throw new Error("Set GQ_SPREADSHEET_ID to the pricing spreadsheet id.");

  const active = await getActiveVersion();
  if (!active) throw new Error("no active pricing version");

  const [admin] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
  if (!admin) throw new Error("no admin user to attribute the quotation to");

  console.log(`Active version: ${active.name}`);
  console.log("Creating a quotation through the GQ-sheet path...\n");

  const result: any = await createGQ1Project(SPREADSHEET_ID, admin.id, "Xpress - GQ- 1");
  const projectId = result?.projectId ?? result?.project?.id ?? result?.id;
  if (!projectId) throw new Error(`could not find the created quotation id in: ${JSON.stringify(result).slice(0, 200)}`);

  const [created] = await db.select().from(projects).where(eq(projects.id, projectId));
  const pinned = created.pricingVersionId === active.id;

  console.log(`\n  ${pinned ? "PASS" : "FAIL"}  GQ-created quotation is pinned to ${active.name}`);
  console.log(`        pricing_version_id = ${created.pricingVersionId ?? "NULL"}`);

  await db.delete(projects).where(eq(projects.id, projectId));
  console.log("        test quotation deleted");

  process.exit(pinned ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
