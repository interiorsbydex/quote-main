/**
 * Clears stress-test debris out of the DEVELOPMENT database and puts the pricing
 * version state back to something realistic: the original bootstrap version live, and a
 * Draft freshly synced from the sheet.
 *
 * Refuses to run against anything that still has projects attached to a test version, so
 * it cannot quietly orphan real data.
 */
import { db } from "../server/db";
import { sql, eq, inArray } from "drizzle-orm";
import { catalogItems, pricingVersions, projects } from "@shared/schema";
import { confirmDatabaseTarget } from "./lib/db-target";

async function main() {
  // This script deletes whole pricing versions. It must never be pointed at the live
  // database by accident.
  const target = await confirmDatabaseTarget("Reset development pricing versions");
  if (target.isProduction) {
    throw new Error("Refusing to run: this script deletes pricing versions and is development-only.");
  }

  const all = await db.select().from(pricingVersions).orderBy(pricingVersions.versionNumber);
  const original = all.find((v) => v.versionNumber === 1);
  if (!original) throw new Error("No version 1 found - refusing to guess which version is the real one.");

  const doomed = all.filter((v) => v.versionNumber !== 1);

  // Never delete a version that a project is priced against.
  for (const v of doomed) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.pricingVersionId, v.id));
    if (n > 0) throw new Error(`${v.name} (v${v.versionNumber}) still prices ${n} project(s) - refusing to delete it.`);
  }

  console.log(`Removing ${doomed.length} test version(s): ${doomed.map((v) => `v${v.versionNumber}`).join(", ")}`);
  const ids = doomed.map((v) => v.id);
  if (ids.length) {
    await db.delete(catalogItems).where(inArray(catalogItems.pricingVersionId, ids));
    await db.execute(sql`DELETE FROM pricing_version_audit WHERE version_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await db.delete(pricingVersions).where(inArray(pricingVersions.id, ids));
  }

  // v1's rows are deliberately left alone. A published version is immutable, so this
  // script resets the version *list* around it and never edits the version itself.
  // (Test debris used to be cleaned out of v1 here, back when items could be copied into
  // a published version. That is no longer possible, so there is nothing to undo.)
  await db.update(pricingVersions).set({ status: "active" }).where(eq(pricingVersions.id, original.id));

  // The app expects a Draft to always exist as the editing surface.
  const [existingDraft] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, "draft")).limit(1);
  if (!existingDraft) {
    const [{ max }] = await db
      .select({ max: sql<number>`COALESCE(MAX(version_number), 1)::int` })
      .from(pricingVersions);
    await db.insert(pricingVersions).values({
      versionNumber: max + 1,
      name: "Draft",
      status: "draft",
      seededFromVersionId: original.id,
      notes: "Working copy. Sync the sheet into this as often as needed; it only becomes a version when published.",
    });
    console.log("Seeded a fresh Draft.");
  }

  const [{ n: items }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, original.id));
  const [{ n: projs }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.pricingVersionId, original.id));

  console.log(`\nDone. Live version: ${original.name} - ${items} items, ${projs} projects.`);
  console.log("Next: npx tsx scripts/sync-draft.ts to fill the Draft from the sheet.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Reset failed:", e.message);
  process.exit(1);
});
