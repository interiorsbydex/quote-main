/**
 * End-to-end stress test for the pricing version engine.
 *
 * The one thing that must never break: a quotation already given to a client must keep
 * its prices no matter what happens to the catalog afterwards. Everything here is built
 * around proving that.
 *
 * Runs against the development database only.
 */
import { db } from "../server/db";
import { sql, eq } from "drizzle-orm";
import { catalogItems, pricingVersions, projects } from "@shared/schema";
import {
  getActiveVersion,
  getDraftVersion,
  publishDraft,
  revertToVersion,
  previewPublish,
  listVersions,
  countVersionItems,
  addProjectCatalogException,
  removeProjectCatalogException,
} from "../server/pricing-versions";
import {
  getCatalogForVersion,
  getCatalogForProject,
  clearVersionCatalogCache,
  clearProjectExceptionCache,
} from "../server/google-sheets";
import { confirmDatabaseTarget } from "./lib/db-target";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

async function expectThrows(name: string, fn: () => Promise<any>, expectFragment?: string) {
  try {
    await fn();
    check(name, false, "expected an error but none was thrown");
  } catch (e: any) {
    const ok = !expectFragment || e.message.toLowerCase().includes(expectFragment.toLowerCase());
    check(name, ok, ok ? "correctly refused" : `wrong error: ${e.message}`);
  }
}

async function snapshot() {
  const r: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM line_items)                          AS line_items,
      (SELECT COALESCE(SUM(amount),0)::bigint FROM line_items)   AS sum_amount,
      (SELECT COALESCE(SUM(rate),0)::bigint  FROM line_items)    AS sum_rate,
      (SELECT COUNT(*) FROM projects)                            AS projects
  `);
  return (r.rows ?? r)[0];
}

async function projectVersionMap() {
  const r: any = await db.execute(sql`
    SELECT pricing_version_id, COUNT(*)::int AS n FROM projects GROUP BY 1 ORDER BY 2 DESC
  `);
  return (r.rows ?? r) as Array<{ pricing_version_id: string; n: number }>;
}

async function main() {
  // This test publishes versions, mangles the Draft and creates throwaway projects.
  // It must never be pointed at the live database.
  const target = await confirmDatabaseTarget("Pricing version engine stress test");
  if (target.isProduction) {
    throw new Error("Refusing to run: this test publishes versions and is development-only.");
  }

  console.log("=".repeat(78));
  console.log("PRICING VERSION ENGINE - STRESS TEST");
  console.log("=".repeat(78));

  const before = await snapshot();
  const v1 = await getActiveVersion();
  const draft0 = await getDraftVersion();
  if (!v1 || !draft0) throw new Error("Not initialised");

  // A previous interrupted run can leave debris behind; clear it so the run starts clean.
  await db.delete(projects).where(eq(projects.clientName, "STRESS TEST - safe to delete"));
  if ((await countVersionItems(draft0.id)) === 0) {
    console.log("  (Draft was empty from an earlier interrupted run - reseeding from live)");
    await copyVersionItems(db, v1.id, draft0.id);
  }

  console.log(`\nStarting state: live=${v1.name} (${await countVersionItems(v1.id)} items), draft=${await countVersionItems(draft0.id)} items`);
  console.log(`Existing projects: ${before.projects}, line items: ${before.line_items}\n`);

  // ---------------------------------------------------------------- invariants
  console.log("[1] Database-enforced invariants");
  await expectThrows(
    "cannot create a second Draft",
    () => db.insert(pricingVersions).values({ versionNumber: 9001, name: "Rogue draft", status: "draft" }),
    "unique"
  );
  await expectThrows(
    "cannot create a second Active",
    () => db.insert(pricingVersions).values({ versionNumber: 9002, name: "Rogue active", status: "active" }),
    "unique"
  );
  await expectThrows(
    "version numbers cannot collide",
    () => db.insert(pricingVersions).values({ versionNumber: v1.versionNumber, name: "Dup", status: "archived" }),
    "unique"
  );

  // ------------------------------------------------------- baseline price read
  console.log("\n[2] Prices served before any publish");
  const v1Catalog = await getCatalogForVersion(v1.id);
  const sampleItem = v1Catalog.find((i) => (i.sellingPrice || i.rate) > 0)!;
  const sampleV1Price = sampleItem.sellingPrice || sampleItem.rate;
  check("live version serves a non-empty catalog", v1Catalog.length > 0, `${v1Catalog.length} items`);

  // -------------------------------------------------------------- publish V2
  console.log("\n[3] Publishing the Draft");
  // Captured so we can prove publishing re-points nobody, regardless of which version
  // each project happened to be sitting on.
  const mapBefore = await projectVersionMap();
  const preview = await previewPublish();
  console.log(`      preview: ${preview.changed.length} changed, ${preview.added.length} new, ${preview.removed.length} removed`);

  const v2 = await publishDraft({ name: "V2 - Stress Test", notes: "automated test", performedBy: undefined });
  clearVersionCatalogCache();

  const afterPublish = await snapshot();
  const versionsNow = await listVersions();
  const activeNow = versionsNow.find((v) => v.status === "active");
  const draftNow = versionsNow.find((v) => v.status === "draft");
  const v1Now = versionsNow.find((v) => v.id === v1.id);

  check("published version is now live", activeNow?.id === v2.id, v2.name);
  check("previous live version was archived", v1Now?.status === "archived");
  check("exactly one Active exists", versionsNow.filter((v) => v.status === "active").length === 1);
  check("exactly one Draft exists", versionsNow.filter((v) => v.status === "draft").length === 1);
  check("a fresh Draft was seeded", !!draftNow && draftNow.id !== v1.id && draftNow.id !== v2.id);
  check(
    "new Draft holds the full catalog",
    (await countVersionItems(draftNow!.id)) === (await countVersionItems(v2.id)),
    `${await countVersionItems(draftNow!.id)} items`
  );

  // ---------------------------------- THE CRITICAL GUARANTEE: quotes unchanged
  console.log("\n[4] Existing client quotations are untouched  <-- the guarantee that matters");
  check("line item count unchanged", String(before.line_items) === String(afterPublish.line_items), `${before.line_items}`);
  check("total quoted value unchanged", String(before.sum_amount) === String(afterPublish.sum_amount), `${before.sum_amount}`);
  check("line item rates unchanged", String(before.sum_rate) === String(afterPublish.sum_rate), `${before.sum_rate}`);

  const mapAfter = await projectVersionMap();
  const mapUnchanged = JSON.stringify(mapBefore) === JSON.stringify(mapAfter);
  const pinnedToOld = mapAfter.filter((m) => m.pricing_version_id !== v2.id).reduce((s, m) => s + m.n, 0);
  check(
    "publishing re-pointed no existing project",
    mapUnchanged,
    `${pinnedToOld}/${before.projects} still on their original version`
  );
  check("no existing project was dragged onto the new version", (mapAfter.find((m) => m.pricing_version_id === v2.id)?.n ?? 0) === 0);

  const v1CatalogAfter = await getCatalogForVersion(v1.id);
  const sameItem = v1CatalogAfter.find((i) => i.id === sampleItem.id);
  check(
    "an old project still reads its original price",
    !!sameItem && (sameItem.sellingPrice || sameItem.rate) === sampleV1Price,
    `${sampleV1Price}`
  );
  check("archived version keeps its own item count", (await countVersionItems(v1.id)) > 0);

  // ------------------------------------------------- new projects get new prices
  console.log("\n[5] New projects pick up the new version");
  const [testProject] = await db
    .insert(projects)
    .values({
      userId: (await db.select({ id: sql`id` }).from(sql`users`).limit(1) as any)[0].id,
      clientName: "STRESS TEST - safe to delete",
      projectType: "Residential",
      defaultCategory: "DeX - Xpress",
      pricingVersionId: (await getActiveVersion())!.id,
    } as any)
    .returning();
  check("new project is stamped with the live version", testProject.pricingVersionId === v2.id);

  // ------------------------------------------------ price change then republish
  console.log("\n[6] Raising a price and publishing again");
  const draftForEdit = await getDraftVersion();
  const [editTarget] = await db
    .select()
    .from(catalogItems)
    .where(sql`${catalogItems.pricingVersionId} = ${draftForEdit!.id} AND ${catalogItems.itemCode} IS NOT NULL AND ${catalogItems.sellingPrice} > 100`)
    .limit(1);

  const oldPrice = editTarget.sellingPrice;
  const newPrice = Math.round(oldPrice * 1.1);
  await db
    .update(catalogItems)
    .set({ sellingPrice: newPrice })
    .where(sql`${catalogItems.pricingVersionId} = ${draftForEdit!.id} AND ${catalogItems.itemCode} = ${editTarget.itemCode}`);
  clearVersionCatalogCache();

  const publishedCountBefore = (await listVersions()).filter((v) => v.status !== "draft").length;
  const preview2 = await previewPublish();
  const found = preview2.changed.find((c) => c.itemCode === editTarget.itemCode);
  check("preview detects the single price change", !!found, `${found?.oldSellingPrice} -> ${found?.newSellingPrice}`);
  check("preview does not invent other changes", preview2.changed.length === 1, `${preview2.changed.length} changed`);

  const v3 = await publishDraft({ name: "V3 - One Price Up", performedBy: undefined });
  clearVersionCatalogCache();
  check(
    "only one new version was created for that edit",
    (await listVersions()).filter((v) => v.status !== "draft").length === publishedCountBefore + 1
  );

  const v2Cat = await getCatalogForVersion(v2.id);
  const v3Cat = await getCatalogForVersion(v3.id);
  const inV2 = v2Cat.find((i) => i.description === editTarget.description && i.unitType === (editTarget.unitType || "General"));
  const inV3 = v3Cat.find((i) => i.description === editTarget.description && i.unitType === (editTarget.unitType || "General"));
  check("the older version keeps the old price", inV2 ? inV2.sellingPrice === oldPrice : false, `${inV2?.sellingPrice} vs ${oldPrice}`);
  check("the new version carries the new price", inV3 ? inV3.sellingPrice === newPrice : false, `${inV3?.sellingPrice} vs ${newPrice}`);

  const afterSecondPublish = await snapshot();
  check("client quotations STILL unchanged", String(before.sum_amount) === String(afterSecondPublish.sum_amount));

  // -------------------------------------------------------- many edits, one version
  console.log("\n[7] Forty edits in one publish produce exactly one version");
  const versionsBeforeBulk = (await listVersions()).length;
  const draftBulk = await getDraftVersion();
  const bulkTargets = await db
    .select()
    .from(catalogItems)
    .where(sql`${catalogItems.pricingVersionId} = ${draftBulk!.id} AND ${catalogItems.itemCode} IS NOT NULL AND ${catalogItems.sellingPrice} > 100`)
    .limit(40);
  for (const t of bulkTargets) {
    await db
      .update(catalogItems)
      .set({ sellingPrice: Math.round(t.sellingPrice * 1.05) })
      .where(sql`${catalogItems.pricingVersionId} = ${draftBulk!.id} AND ${catalogItems.itemCode} = ${t.itemCode}`);
  }
  clearVersionCatalogCache();
  const preview3 = await previewPublish();
  check("preview shows all forty changes", preview3.changed.length >= 39 && preview3.changed.length <= 41, `${preview3.changed.length}`);
  await publishDraft({ name: "V4 - Bulk Increase", performedBy: undefined });
  clearVersionCatalogCache();
  check(
    "forty edits created exactly one new version",
    (await listVersions()).length === versionsBeforeBulk + 1,
    `${versionsBeforeBulk} -> ${(await listVersions()).length}`
  );

  // ------------------------------------------------------------------- refusals
  console.log("\n[8] Dangerous publishes are refused");
  const draftEmpty = (await getDraftVersion())!;

  // The Draft gets deliberately mangled below, so park a copy first and restore it in a
  // finally block. The backup deliberately does NOT live in a pricing version: parking it
  // in a spare "archived" version used to work, but published versions are now frozen, so
  // writing into one is refused — correctly. A plain side table keeps the backup entirely
  // outside the versioning model. Row-by-row backup through JS blows past the
  // bind-parameter limit at this catalog size, so the copy stays inside Postgres.
  await db.execute(sql`DROP TABLE IF EXISTS _stress_draft_backup`);
  await db.execute(sql`CREATE TABLE _stress_draft_backup AS SELECT * FROM catalog_items WHERE pricing_version_id = ${draftEmpty.id}`);

  const backedUp: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM _stress_draft_backup`);
  const backupRows = (backedUp.rows ?? backedUp)[0].n as number;
  const restoreDraft = () => db.execute(sql`INSERT INTO catalog_items SELECT * FROM _stress_draft_backup`);

  try {
    check("draft backed up before destructive tests", backupRows > 2000, `${backupRows} rows`);

    await db.delete(catalogItems).where(eq(catalogItems.pricingVersionId, draftEmpty.id));
    await expectThrows("publishing an empty Draft is refused", () => publishDraft({ performedBy: undefined }), "empty");

    // Simulate a sync that died halfway: only a sliver of the catalog is present.
    await restoreDraft();
    await db.execute(sql`
      DELETE FROM catalog_items
      WHERE pricing_version_id = ${draftEmpty.id}
        AND id NOT IN (SELECT id FROM catalog_items WHERE pricing_version_id = ${draftEmpty.id} LIMIT 50)
    `);
    await expectThrows(
      "publishing a suspiciously small Draft is refused",
      () => publishDraft({ performedBy: undefined }),
      "incomplete sync"
    );
  } finally {
    await db.delete(catalogItems).where(eq(catalogItems.pricingVersionId, draftEmpty.id));
    await restoreDraft();
    await db.execute(sql`DROP TABLE IF EXISTS _stress_draft_backup`);
    clearVersionCatalogCache();
  }
  check("draft fully restored afterwards", (await countVersionItems(draftEmpty.id)) > 2000, `${await countVersionItems(draftEmpty.id)} rows`);

  // --------------------------------------------------------------------- revert
  console.log("\n[9] Revert");
  const liveBeforeRevert = (await getActiveVersion())!;
  const reverted = await revertToVersion(v2.id, undefined);
  clearVersionCatalogCache();
  check("reverted version is live", reverted.id === v2.id);
  check("previously live version was archived", (await listVersions()).find((v) => v.id === liveBeforeRevert.id)?.status === "archived");
  check("still exactly one Active", (await listVersions()).filter((v) => v.status === "active").length === 1);
  const afterRevert = await snapshot();
  check("revert did not touch any quotation", String(before.sum_amount) === String(afterRevert.sum_amount));
  const draftIdForRevert = (await getDraftVersion())!.id;
  await expectThrows("the Draft cannot be made live directly", () => revertToVersion(draftIdForRevert), "publish it instead");

  // -------------------------------------------- a newer product on ONE quotation
  console.log("\n[10] Giving one quotation a product from a newer price list");
  // The old answer to this was to copy the product into the older version. That version
  // is shared by every quotation pinned to it, so the copy silently changed catalogs that
  // nobody asked to change. The product is now attached to the single project instead,
  // and the published version is never touched.
  const liveNow = (await getActiveVersion())!;
  const oldest = (await listVersions())
    .filter((v) => v.status !== "draft")
    .sort((a, b) => a.versionNumber - b.versionNumber)[0];
  const liveCodes = await db
    .select({ code: catalogItems.itemCode })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, liveNow.id));
  const oldCodes = new Set(
    (await db.select({ code: catalogItems.itemCode }).from(catalogItems).where(eq(catalogItems.pricingVersionId, oldest.id)))
      .map((r) => r.code)
      .filter(Boolean)
  );
  const missingCode = liveCodes.map((r) => r.code).find((c) => c && !oldCodes.has(c));

  // Pin the throwaway project to the older version so it is missing that product.
  await db.update(projects).set({ pricingVersionId: oldest.id }).where(eq(projects.id, testProject.id));

  if (missingCode) {
    console.log(`      granting ${missingCode} to one quotation on ${oldest.name}`);
    const versionCountBefore = await countVersionItems(oldest.id);
    const catalogBefore = await getCatalogForProject(oldest.id, testProject.id);

    await addProjectCatalogException({ projectId: testProject.id, itemCode: missingCode, reason: "stress test" });
    clearProjectExceptionCache(testProject.id);

    const catalogAfter = await getCatalogForProject(oldest.id, testProject.id);
    check("the quotation can now see the newer product", catalogAfter.length === catalogBefore.length + 1,
      `${catalogBefore.length} -> ${catalogAfter.length}`);
    check("the older version itself did not change", (await countVersionItems(oldest.id)) === versionCountBefore,
      `${versionCountBefore} rows`);

    const sharedCatalog = await getCatalogForVersion(oldest.id);
    check("every other quotation on that version is unaffected", !sharedCatalog.some((i) => i.itemCode === missingCode));

    await expectThrows(
      "the same product cannot be granted twice",
      () => addProjectCatalogException({ projectId: testProject.id, itemCode: missingCode! }),
      "already"
    );

    const afterException = await snapshot();
    check("granting it did not touch any quotation's totals", String(before.sum_amount) === String(afterException.sum_amount));

    await removeProjectCatalogException(testProject.id, missingCode);
    clearProjectExceptionCache(testProject.id);
    const catalogRestored = await getCatalogForProject(oldest.id, testProject.id);
    check("removing it puts the quotation back", catalogRestored.length === catalogBefore.length,
      `${catalogBefore.length} -> ${catalogRestored.length}`);
  } else {
    console.log("      (skipped - no product exists only in the live version)");
  }

  // ------------------------------------------------------------------- cleanup
  // Deleting the project cascades to its catalog exceptions.
  await db.delete(projects).where(eq(projects.id, testProject.id));

  // ------------------------------------------------------------------- summary
  const final = await snapshot();
  console.log("\n" + "=".repeat(78));
  console.log(`FINAL: line items ${before.line_items} -> ${final.line_items}, value ${before.sum_amount} -> ${final.sum_amount}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) console.log(`FAILED: ${failures.join(", ")}`);
  console.log("=".repeat(78));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nTEST HARNESS ERROR:", e);
  process.exit(1);
});
