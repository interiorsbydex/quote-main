---
name: Production schema changes
description: How a new table or column reaches the production database on Replit, and why hand-applying it is wrong even when a migration file exists.
---

The production database schema is applied by Replit's publish flow, not by the agent. On
publish, Replit introspects development and production, diffs them, asks the user to confirm
any rename, and applies the difference. Development is the source the diff reads from, so the
job is to get development right and then have the user publish.

Never run DDL against production: not through a migration script, not a deploy build hook, not
`CREATE TABLE IF NOT EXISTS` at server startup, and not through the SQL callback (production
access is a read-only replica and will reject it).

**Why:** a hand-applied production schema silently diverges from what the publish diff believes
production contains, and deploy-time or startup-time DDL re-runs on every release. The read-only
guard on production is the platform telling you the same thing — the answer is to publish, not
to find a way around it.

**How to apply:** before telling anyone a release is safe, diff the two databases by comparing
`information_schema.columns` for `public` in development and production. The rows present only
in development are exactly what publishing will add; rows present only in production are what it
would drop, and those deserve a conversation before anyone clicks Publish.

A hand-written SQL migration file in this repo is a *development* convenience — here, because
`drizzle-kit push` prompts interactively for an unrelated constraint on a large table. It is not
the route to production, and the script that applies such files refuses to run against anything
but development.
