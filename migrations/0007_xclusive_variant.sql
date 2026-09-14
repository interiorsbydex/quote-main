-- Add sync reporting for the DeX - Xclusive catalog variant.
-- The tab configuration itself is inserted by seedSheetTabs from DEFAULT_SHEET_TABS.
--
-- Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE catalog_sync_logs
  ADD COLUMN IF NOT EXISTS xclusive_count INTEGER NOT NULL DEFAULT 0;

COMMIT;