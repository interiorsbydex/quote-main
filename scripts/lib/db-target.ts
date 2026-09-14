/**
 * Guard rail for scripts that write to a database.
 *
 * Every script here connects through DATABASE_URL, which normally points at the
 * development database. A production run means deliberately redirecting that variable,
 * and that is easy to get wrong in BOTH directions:
 *
 *   - hitting production when you meant to rehearse on development, or
 *   - believing you migrated production when you only touched development, and reading
 *     the resulting "nothing changed" as success.
 *
 * So before any write, a script states which database it is about to touch, and refuses
 * to continue unless the operator's stated intent matches reality.
 *
 * Usage:
 *   EXPECT_DB=production CONFIRM_PRODUCTION=I_UNDERSTAND DATABASE_URL="$NEON_DATABASE_URL" npx tsx scripts/x.ts
 *   EXPECT_DB=development npx tsx scripts/x.ts
 */
import { pool } from "../../server/db";

interface TargetInfo {
  host: string;
  database: string;
  isProduction: boolean;
  projects: number;
  newestProject: string | null;
}

/** Host and database name only — never the credentials. */
function describe(url: string): { host: string; database: string } {
  const u = new URL(url);
  return { host: u.hostname, database: u.pathname.replace(/^\//, "") };
}

export async function confirmDatabaseTarget(scriptName: string): Promise<TargetInfo> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const target = describe(url);
  const prodUrl = process.env.NEON_DATABASE_URL;
  const prod = prodUrl ? describe(prodUrl) : null;
  const isProduction = !!prod && prod.host === target.host && prod.database === target.database;

  // Without the production URL to compare against, "this is not production" is a guess,
  // and the guess fails open: production would be labelled development and waved through.
  // Fail closed instead and demand confirmation.
  const unclassifiable = !prod;

  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM projects) AS projects,
            (SELECT MAX(created_at)::date FROM projects) AS newest`
  );
  const projects = Number(rows[0].projects);
  const newestProject = rows[0].newest ? String(rows[0].newest) : null;

  const label = isProduction
    ? "PRODUCTION (live business data)"
    : unclassifiable
      ? "UNKNOWN - cannot rule out production"
      : "development";
  console.log("\n" + "=".repeat(72));
  console.log(`  ${scriptName}`);
  console.log("=".repeat(72));
  console.log(`  target        ${label}`);
  console.log(`  host          ${target.host}`);
  console.log(`  database      ${target.database}`);
  console.log(`  projects      ${projects}`);
  console.log(`  newest quote  ${newestProject ?? "none"}`);
  console.log("=".repeat(72) + "\n");

  // Catches "I thought I was pointing at production but I wasn't", which otherwise
  // looks like a clean run that changed nothing.
  const expected = process.env.EXPECT_DB;
  if (expected) {
    if (unclassifiable) {
      throw new Error(
        `Refusing to run: EXPECT_DB=${expected} cannot be checked because NEON_DATABASE_URL ` +
          `is not set, so this connection cannot be classified.`
      );
    }
    const actual = isProduction ? "production" : "development";
    if (expected !== actual) {
      throw new Error(
        `Refusing to run: EXPECT_DB=${expected} but this connection is ${actual}. ` +
          `Check DATABASE_URL before retrying.`
      );
    }
  }

  if ((isProduction || unclassifiable) && process.env.CONFIRM_PRODUCTION !== "I_UNDERSTAND") {
    throw new Error(
      unclassifiable
        ? "Refusing to write: NEON_DATABASE_URL is not set, so this connection cannot be " +
          "proven to be non-production. Set it, or pass CONFIRM_PRODUCTION=I_UNDERSTAND."
        : "Refusing to write to PRODUCTION without confirmation. " +
          "Re-run with CONFIRM_PRODUCTION=I_UNDERSTAND if that is genuinely intended."
    );
  }

  return { ...target, isProduction, projects, newestProject };
}
