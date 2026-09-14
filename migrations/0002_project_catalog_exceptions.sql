-- Per-quotation catalog exceptions.
--
-- A quotation is pinned to the price list that was live when it was created, so a
-- product introduced later is not in its catalog. Occasionally a client on an older
-- quotation genuinely wants one of those newer products.
--
-- The answer is NOT to edit the older published version: that version is shared by every
-- quotation pinned to it, and published versions are immutable by design. Instead the
-- extra product is recorded against the ONE project that needs it, priced from the
-- version it is copied from.
--
-- Idempotent: safe to run more than once.
--
-- DEVELOPMENT ONLY. This file exists because `npm run db:push` prompts interactively for
-- an unrelated constraint on the projects table, so the dev database was given this table
-- directly instead. The PRODUCTION database is not migrated from here: Replit's publish
-- flow diffs development against production and applies the difference itself. Do not run
-- this, or any other script, against production.

BEGIN;

CREATE TABLE IF NOT EXISTS project_catalog_exceptions (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         VARCHAR   NOT NULL REFERENCES projects(id)         ON DELETE CASCADE,
  item_code          TEXT      NOT NULL,
  source_version_id  VARCHAR   NOT NULL REFERENCES pricing_versions(id) ON DELETE CASCADE,
  reason             TEXT,
  added_by           VARCHAR            REFERENCES users(id)            ON DELETE SET NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_project_catalog_exceptions_project"
  ON project_catalog_exceptions (project_id);

-- One product can be granted to a project only once.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_project_catalog_exception"
  ON project_catalog_exceptions (project_id, item_code);

COMMIT;
