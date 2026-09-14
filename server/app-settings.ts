/**
 * Admin-flippable switches, stored in the database so they survive a restart and can be
 * changed without a release.
 */
import { db } from './db';
import { appSettings } from '../shared/schema';
import { eq } from 'drizzle-orm';

/**
 * While instant sync is ON, refreshing from the Google Sheet applies the result to the
 * live price list immediately — the behaviour the app had before pricing versions
 * existed. While it is OFF, a sync only fills the Draft and an admin decides when it
 * goes live.
 *
 * Defaults to ON when the row is missing, because that is the behaviour the team relies
 * on today; the review workflow is opted into deliberately.
 */
export const INSTANT_SYNC_KEY = 'instant_sync';

/** Cached so the setting can be read on hot paths without a query each time. */
let cached: { value: boolean; readAt: number } | null = null;
const CACHE_MS = 5_000;

/**
 * @param options.fresh Skip the cache. Required before acting on the setting — a stale
 *   cached "on" in one server process would push prices live moments after an admin
 *   turned the review step back on. Reads for display can use the cache.
 */
export async function isInstantSyncEnabled(options: { fresh?: boolean } = {}): Promise<boolean> {
  if (!options.fresh && cached && Date.now() - cached.readAt < CACHE_MS) return cached.value;

  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, INSTANT_SYNC_KEY)).limit(1);
    const value = row ? row.value !== 'false' : true;
    cached = { value, readAt: Date.now() };
    return value;
  } catch (error: any) {
    // If the setting cannot be read, do not push prices to everyone on a guess. Failing
    // this way leaves the sheet in the Draft, which an admin can still apply by hand.
    console.error('Could not read the instant-sync setting, so prices will not be applied automatically:', error.message);
    return false;
  }
}

export async function setInstantSyncEnabled(enabled: boolean, updatedBy?: string): Promise<boolean> {
  await db
    .insert(appSettings)
    .values({ key: INSTANT_SYNC_KEY, value: enabled ? 'true' : 'false', updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: enabled ? 'true' : 'false', updatedAt: new Date(), updatedBy: updatedBy ?? null },
    });

  cached = { value: enabled, readAt: Date.now() };
  return enabled;
}
