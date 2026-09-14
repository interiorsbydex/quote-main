-- Attribution for products created through the Admin Add New Product flow.
-- Existing Sheet-synced rows remain null. The existing created_at column records when
-- each new catalog row was inserted.
--
-- Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS created_by VARCHAR;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_items_created_by_users_id_fk'
  ) THEN
    ALTER TABLE catalog_items
      ADD CONSTRAINT catalog_items_created_by_users_id_fk
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMIT;