---
name: Database environments (dev vs production)
description: This project has two separate Postgres databases; DATABASE_URL is NOT production. Read before any migration, backfill, or data query.
---

# Two separate databases

`DATABASE_URL` and `NEON_DATABASE_URL` point at **different databases with different data**.

- `DATABASE_URL` → a Replit-hosted database (`helium/heliumdb`). This is what the
  workspace dev server (`npm run dev`) and `drizzle.config.ts` use. Its data is a stale
  snapshot, months behind production.
- `NEON_DATABASE_URL` → the Neon database that the **published/production** deployment
  actually runs on. This is the live business data.

**Why this matters:** running a migration or backfill with the default `DATABASE_URL`
touches only dev. Production needs the same migration applied explicitly against
`NEON_DATABASE_URL` at release time. Conversely, an exploratory query against
`NEON_DATABASE_URL` is hitting live customer data — treat it as read-only unless the
change is deliberate.

**How to apply:** before quoting record counts to the user as "live" figures, confirm
which URL was queried. Before any schema change, apply to dev first, verify, then apply
to production as a separate deliberate step. A quick way to tell them apart is the most
recent `projects.created_at` — production is current, dev is stale.

# Writing to production

The `executeSql` production environment is a **read-only replica** — SELECT only. A
deliberate, user-authorised production data change therefore has to go through
`NEON_DATABASE_URL` directly (node `pg` inside a `"use impure"` function), or through the
deployed app's admin API. Never treat "executeSql refused the write" as "the change is
impossible"; treat it as a prompt to confirm the change is genuinely authorised first.

**Why:** the replica exists to make casual production reads safe, not to block intended
operations.

**How to apply:** replicate exactly what the app's own service function does (same
advisory lock, same status transitions, same audit-log row), guard it with a
precondition check inside the transaction that aborts if the current state isn't what you
expect, and verify after commit.

# Live-version switches take effect without a redeploy

Changing which pricing version is `active` directly in the production DB is picked up
immediately by the running server: the active version is resolved from the DB on every
catalog request, and per-version catalog caches are keyed by a version id whose rows are
immutable. The one process-global catalog cache left over from before versioning only
feeds a non-price endpoint.

**Why:** it looked like an in-memory cache would serve stale prices until a restart, and
a restart isn't something the agent can trigger in production.

**How to apply:** before assuming a cache forces a redeploy, check whether the value in
question is re-read per request and whether the cache key is immutable.
