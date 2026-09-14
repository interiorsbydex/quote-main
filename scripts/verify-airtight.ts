/**
 * Verifies the guarantees added by "make catalog versioning airtight", against the
 * development database.
 *
 * Every check either proves a refusal (a published version cannot be written to) or
 * proves an addition is contained (a per-project product reaches exactly one project).
 * Anything this script creates, it removes again.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from '../server/db';
import { pricingVersions, projects, catalogItems, projectCatalogExceptions } from '../shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import {
  assertVersionMutable,
  copyVersionItems,
  addProjectCatalogException,
  removeProjectCatalogException,
  listProjectCatalogExceptions,
} from '../server/pricing-versions';
import { getCatalogForProject, clearProjectExceptionCache } from '../server/google-sheets';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function expectRejection(name: string, fn: () => Promise<unknown>, mustMention: string) {
  try {
    await fn();
    check(name, false, 'it was allowed');
  } catch (e: any) {
    check(name, String(e.message).includes(mustMention), `wrong reason: ${e.message}`);
  }
}

async function main() {
  console.log(`\nDatabase: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] ?? 'unknown'}\n`);

  const [active] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, 'active')).limit(1);
  const [draft] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, 'draft')).limit(1);
  const [archived] = await db.select().from(pricingVersions).where(eq(pricingVersions.status, 'archived')).limit(1);
  if (!active || !draft) throw new Error('Need an active and a draft version to test against.');

  console.log('1. Published versions refuse writes');
  await expectRejection(
    'writing into the live version is refused',
    () => db.transaction((tx) => assertVersionMutable(tx, active.id, 'Test')),
    'cannot be changed'
  );
  if (archived) {
    await expectRejection(
      'writing into an archived version is refused',
      () => db.transaction((tx) => assertVersionMutable(tx, archived.id, 'Test')),
      'cannot be changed'
    );
  }
  await expectRejection(
    'copying rows into the live version is refused',
    () => db.transaction((tx) => copyVersionItems(tx, draft.id, active.id)),
    'cannot be changed'
  );
  await db.transaction(async (tx) => {
    await assertVersionMutable(tx, draft.id, 'Test');
    check('the Draft is still writable', true);
  });

  // A guard that only covers the paths that exist today is not a guarantee. The real
  // risk is a script added months from now that writes catalog rows directly, by an
  // author who never learns the rule exists. So scan every runnable file in the
  // repository, not just the server, and assert the set of files that touch catalog rows
  // has not grown.
  //
  // Application code:  the sync and the version engine. Both go through
  //                    assertVersionMutable, so they cannot reach a published version.
  // Development tools: allowed, because they are how the engine gets tested and reset.
  //                    Each one is listed deliberately and each refuses to run against
  //                    production. A NEW file appearing here fails this check on purpose.
  const ALLOWED_WRITE_FILES = [
    'server/catalog-sync.ts',
    'server/pricing-versions.ts',
    'scripts/reset-dev-versions.ts',
    'scripts/stress-test-versions.ts',
  ];

  const writeSites = execSync(
    `grep -rlE "insert\\(catalogItems\\)|update\\(catalogItems\\)|delete\\(catalogItems\\)|(INSERT INTO|UPDATE|DELETE FROM) catalog_items" . --include=*.ts --exclude-dir=node_modules --exclude-dir=dist || true`,
    { cwd: process.cwd(), encoding: 'utf8' }
  ).trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));

  const stray = writeSites.filter(f => !ALLOWED_WRITE_FILES.includes(f));
  check('nothing new writes catalog rows outside the known files', stray.length === 0, stray.join(', '));

  // The development tools in that list are only safe because they cannot be pointed at
  // the live database. If one loses its guard, the allowlist above becomes a loophole.
  const unguarded = ALLOWED_WRITE_FILES
    .filter(f => f.startsWith('scripts/'))
    .filter(f => !readFileSync(f, 'utf8').includes('confirmDatabaseTarget'));
  check('every development tool that writes catalog rows refuses to run against production',
    unguarded.length === 0, unguarded.join(', '));

  const beforeLive = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogItems)
    .where(eq(catalogItems.pricingVersionId, active.id)))[0].n;

  console.log('\n2. A per-project product reaches exactly one project');
  // Prefer a quotation on an older version — that is the situation this feature exists
  // for — and pick a second quotation on the SAME version as the bystander, so the test
  // proves containment where leakage would actually be possible.
  const candidates: any = await db.execute(sql`
    SELECT id, pricing_version_id FROM projects
    WHERE pricing_version_id IS NOT NULL
    ORDER BY (pricing_version_id = ${active.id}) ASC
    LIMIT 1
  `);
  const target = (candidates.rows ?? candidates)[0]
    ? { id: (candidates.rows ?? candidates)[0].id as string, pricingVersionId: (candidates.rows ?? candidates)[0].pricing_version_id as string }
    : null;
  if (!target) throw new Error('No project available to test with.');

  const bystanderRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.pricingVersionId, target.pricingVersionId), sql`${projects.id} <> ${target.id}`))
    .limit(1);
  const bystander = bystanderRows[0] ?? null;

  // A product that exists in the live version but not in the target's own version.
  const candidate: any = (await db.execute(sql`
    SELECT item_code FROM catalog_items
    WHERE pricing_version_id = ${active.id}
      AND item_code IS NOT NULL
      AND item_code NOT IN (
        SELECT item_code FROM catalog_items
        WHERE pricing_version_id = ${target.pricingVersionId} AND item_code IS NOT NULL
      )
    LIMIT 1
  `));
  const missingCode = (candidate.rows ?? candidate)[0]?.item_code as string | undefined;

  if (!missingCode) {
    console.log('  – skipped: every live product already exists in the target version');
  } else {
    const before = await getCatalogForProject(target.pricingVersionId!, target.id);

    await addProjectCatalogException({
      projectId: target.id,
      itemCode: missingCode,
      reason: 'automated verification',
      performedBy: undefined,
    });
    clearProjectExceptionCache(target.id);

    const after = await getCatalogForProject(target.pricingVersionId!, target.id);
    check('the product appears on the target quotation', after.length === before.length + 1,
      `${before.length} → ${after.length}`);

    const listed = await listProjectCatalogExceptions(target.id);
    check('it is listed with its source version', listed.some(r => r.itemCode === missingCode && !!r.sourceVersionName));

    if (bystander) {
      const other = await getCatalogForProject(bystander.pricingVersionId!, bystander.id);
      const baseline = await getCatalogForProject(bystander.pricingVersionId!);
      check('another quotation on the same version is unaffected', other.length === baseline.length,
        `${baseline.length} → ${other.length}`);
    }

    const liveNow = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(eq(catalogItems.pricingVersionId, active.id)))[0].n;
    check('no price list gained a row', liveNow === beforeLive, `${beforeLive} → ${liveNow}`);

    await expectRejection(
      'adding the same product twice is refused',
      () => addProjectCatalogException({ projectId: target.id, itemCode: missingCode }),
      'already'
    );

    await expectRejection(
      'taking a product from the Draft is refused',
      () => addProjectCatalogException({ projectId: target.id, itemCode: 'ZZZ-9999', sourceVersionId: draft.id }),
      'cannot be taken from the Draft'
    );

    // ---- clean up -------------------------------------------------------------
    await removeProjectCatalogException(target.id, missingCode);
    clearProjectExceptionCache(target.id);
    const restored = await getCatalogForProject(target.pricingVersionId!, target.id);
    check('removing it restores the original catalog', restored.length === before.length,
      `${before.length} → ${restored.length}`);

    const leftovers = await db
      .select()
      .from(projectCatalogExceptions)
      .where(and(eq(projectCatalogExceptions.projectId, target.id), eq(projectCatalogExceptions.itemCode, missingCode)));
    check('nothing was left behind', leftovers.length === 0);
  }

  // -------------------------------------------------------------------------------
  // 3. The containment above is a service-layer fact. It is only a real guarantee if
  //    the HTTP surface refuses to hand one quotation's catalog to someone else, so
  //    this section goes through the running server rather than calling functions.
  console.log('\n3. One quotation\'s catalog is not readable by others');
  const base = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null;
  if (!base) {
    console.log('  – skipped: REPLIT_DEV_DOMAIN is not set, so the server cannot be reached');
  } else {
    const reachable = await fetch(`${base}/api/catalog`).then(r => r.status !== 0).catch(() => false);
    if (!reachable) {
      console.log('  – skipped: the app is not running');
    } else {
      const anon = await fetch(`${base}/api/catalog?projectId=${target.id}`);
      check('an anonymous request for a quotation\'s catalog is refused', anon.status === 401,
        `got ${anon.status}`);

      // A real signed-in user who simply does not own this quotation.
      const username = 'zz-airtight-outsider';
      const password = randomBytes(18).toString('base64url');
      await db.execute(sql`DELETE FROM users WHERE username = ${username}`);
      await db.execute(sql`
        INSERT INTO users (username, password, role, status)
        VALUES (${username}, ${await bcrypt.hash(password, 10)}, 'user', 'active')
      `);
      try {
        const login = await fetch(`${base}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        // The session cookie is Secure, so this only works over the https domain.
        const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
        check('the outsider can sign in', login.status === 200 && !!cookie, `got ${login.status}`);

        const asOutsider = await fetch(`${base}/api/catalog?projectId=${target.id}`, { headers: { cookie } });
        check('a signed-in outsider is refused another quotation\'s catalog', asOutsider.status === 403,
          `got ${asOutsider.status}`);

        const ownCatalog = await fetch(`${base}/api/catalog`, { headers: { cookie } });
        check('they can still browse the general price list', ownCatalog.status === 200,
          `got ${ownCatalog.status}`);
      } finally {
        await db.execute(sql`DELETE FROM users WHERE username = ${username}`);
      }
    }
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
