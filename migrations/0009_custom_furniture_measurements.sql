ALTER TABLE "catalog_items"
  ADD COLUMN IF NOT EXISTS "requires_length" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requires_height" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requires_depth" boolean NOT NULL DEFAULT false;

ALTER TABLE "line_items"
  ADD COLUMN IF NOT EXISTS "depth_ft" real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "depth_mm" real NOT NULL DEFAULT 0;