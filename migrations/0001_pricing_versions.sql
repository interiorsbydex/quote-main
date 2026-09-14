-- Catalog Pricing Version Engine — additive-only schema migration.
--
-- Safety properties:
--   * Creates new tables and adds new nullable columns only.
--   * Drops, renames and type changes: none.
--   * Fully idempotent (IF NOT EXISTS everywhere), so a partial run can be re-run.
--   * No behaviour change on its own; existing reads and writes are untouched.

BEGIN;

-- ---------------------------------------------------------------- pricing_versions
CREATE TABLE IF NOT EXISTS pricing_versions (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number         INTEGER NOT NULL,
  name                   TEXT NOT NULL,
  effective_date         TIMESTAMP,
  status                 TEXT NOT NULL DEFAULT 'draft',
  item_count             INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT,
  seeded_from_version_id VARCHAR,
  published_at           TIMESTAMP,
  published_by           VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  archived_at            TIMESTAMP,
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  updated_at             TIMESTAMP NOT NULL DEFAULT now()
);

-- The engine's central invariants, enforced by the database rather than by
-- application code: at most one Draft and at most one Active can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pricing_versions_single_draft"
  ON pricing_versions (status) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pricing_versions_single_active"
  ON pricing_versions (status) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pricing_versions_number"
  ON pricing_versions (version_number);

-- ------------------------------------------------------------- catalog_sheet_tabs
-- Tabs are pinned by stable numeric Google Sheets gid, never by title: the live
-- spreadsheet has two tabs whose titles differ only by a trailing space.
CREATE TABLE IF NOT EXISTS catalog_sheet_tabs (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_tab_id     INTEGER NOT NULL UNIQUE,
  tab_title        TEXT NOT NULL,
  category_name    TEXT NOT NULL,
  item_code_prefix TEXT NOT NULL,
  layout           TEXT NOT NULL,
  item_type        TEXT NOT NULL DEFAULT 'woodworks',
  enabled          BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- item_code_sequences
CREATE TABLE IF NOT EXISTS item_code_sequences (
  prefix     TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------- pricing_version_audit
CREATE TABLE IF NOT EXISTS pricing_version_audit (
  id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id      VARCHAR REFERENCES pricing_versions(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  catalog_item_id VARCHAR,
  item_code       TEXT,
  summary         TEXT NOT NULL,
  details         JSONB DEFAULT '{}'::jsonb,
  performed_by    VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_pricing_version_audit_version"
  ON pricing_version_audit (version_id);
CREATE INDEX IF NOT EXISTS "IDX_pricing_version_audit_created"
  ON pricing_version_audit (created_at);

-- ------------------------------------------------------------ catalog_items columns
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS pricing_version_id          VARCHAR REFERENCES pricing_versions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS item_code                   TEXT,
  ADD COLUMN IF NOT EXISTS sheet_tab_id                INTEGER,
  ADD COLUMN IF NOT EXISTS is_backported               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backported_from_version_id  VARCHAR,
  ADD COLUMN IF NOT EXISTS backported_by               VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS backported_at               TIMESTAMP;

CREATE INDEX IF NOT EXISTS "IDX_catalog_items_version"
  ON catalog_items (pricing_version_id);
CREATE INDEX IF NOT EXISTS "IDX_catalog_items_version_code"
  ON catalog_items (pricing_version_id, item_code);

-- ------------------------------------------------------------------ projects column
-- Nullable: pre-existing rows stay valid until the V1 backfill assigns them.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS pricing_version_id VARCHAR REFERENCES pricing_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "IDX_projects_pricing_version"
  ON projects (pricing_version_id);

COMMIT;
