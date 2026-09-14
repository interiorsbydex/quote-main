/**
 * Every route that creates a quotation must pin it to a pricing version. A quotation left
 * unpinned silently reprices the next time the catalog is published, which is the exact
 * failure the versioning system exists to prevent.
 *
 * Runs against development only.
 *
 * Usage: npx tsx scripts/test-project-stamping.ts
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../server/db";
import { projects, pricingVersions } from "../shared/schema";
import { storage } from "../server/storage";
import { createProjectWithActiveVersion, getActiveVersion } from "../server/pricing-versions";
import { confirmDatabaseTarget } from "./lib/db-target";

const created: string[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  await confirmDatabaseTarget("test-project-stamping");

  const active = await getActiveVersion();
  if (!active) throw new Error("development has no active pricing version");
  console.log(`Active version: ${active.name}\n`);

  console.log("1. createProjectWithActiveVersion (the normal /api/projects path)");
  const direct = await createProjectWithActiveVersion({
    userId: (await db.select().from(projects).limit(1))[0].userId,
    clientName: "stamping-test-direct",
    projectType: "Residential",
    defaultCategory: "DeX - Xpress",
  });
  created.push(direct.id);
  check("stamped with the live version", direct.pricingVersionId === active.id, `${direct.pricingVersionId}`);

  console.log("\n2. storage.createProject with no version supplied (the generic path)");
  const generic = await storage.createProject({
    userId: direct.userId,
    clientName: "stamping-test-generic",
    projectType: "Residential",
    defaultCategory: "DeX - Xpress",
  } as any);
  created.push(generic.id);
  check("stamped with the live version", generic.pricingVersionId === active.id, `${generic.pricingVersionId}`);

  console.log("\n3. duplicateProject must inherit the ORIGINAL's version, not the live one");
  // Pin the source to an older version so inheriting and stamping-live are distinguishable.
  const older = (await db.select().from(pricingVersions).where(eq(pricingVersions.status, "archived")).limit(1))[0];
  if (!older) {
    check("an archived version exists to test against", false, "none found");
  } else {
    await db.update(projects).set({ pricingVersionId: older.id }).where(eq(projects.id, direct.id));
    const copy = await storage.duplicateProject(direct.id, direct.userId);
    created.push(copy.id);
    check(
      `inherited ${older.name} instead of jumping to ${active.name}`,
      copy.pricingVersionId === older.id,
      `${copy.pricingVersionId}`,
    );
  }

  console.log("\n4. no quotation anywhere is left unpinned");
  const res: any = await db.execute(
    sql`SELECT count(*)::int AS count FROM projects WHERE pricing_version_id IS NULL`,
  );
  const count = Number((res.rows ?? res)[0].count);
  check("zero unpinned quotations", count === 0, `${count} unpinned`);
}

main()
  .catch((e) => {
    console.error("\nERROR:", e.message);
    failures++;
  })
  .finally(async () => {
    for (const id of created) await db.delete(projects).where(eq(projects.id, id));
    console.log(`\ncleaned up ${created.length} test quotations`);
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  });
