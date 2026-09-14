-- Header-driven Furniture master fields. Safe to apply repeatedly.
BEGIN;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS applicable_area TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS product_category TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS sub_category TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS finish_type TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS dimension TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
COMMIT;