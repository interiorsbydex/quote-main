-- Additive schema for assignment roles, quote offers, room sub-categories and
-- milestone-stage configuration. Safe to apply repeatedly.
BEGIN;

-- -------------------------------------------------------------- users/projects
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cohort TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS tl_id VARCHAR,
  ADD COLUMN IF NOT EXISTS bl_id VARCHAR,
  ADD COLUMN IF NOT EXISTS dm_id VARCHAR;

-- --------------------------------------------------------------- line_items
ALTER TABLE line_items
  ADD COLUMN IF NOT EXISTS subcategory_id VARCHAR,
  ADD COLUMN IF NOT EXISTS catalog_item_code TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_complimentary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS complimentary_offer_name TEXT;

-- ------------------------------------------------------------------- offers
CREATE TABLE IF NOT EXISTS offers (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  product_category   TEXT NOT NULL DEFAULT 'Offer Product',
  offer_type         TEXT NOT NULL,
  percentage_value   REAL,
  cash_value         REAL,
  min_woodwork_value REAL NOT NULL DEFAULT 0,
  max_woodwork_value REAL,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMP NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_offers (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         VARCHAR NOT NULL,
  offer_id           VARCHAR NOT NULL,
  offer_name         TEXT NOT NULL,
  product_category   TEXT NOT NULL DEFAULT 'Offer Product',
  offer_type         TEXT NOT NULL,
  percentage_value   REAL,
  cash_value         REAL,
  min_woodwork_value REAL NOT NULL DEFAULT 0,
  max_woodwork_value REAL,
  is_locked          BOOLEAN NOT NULL DEFAULT false,
  locked_at          TIMESTAMP,
  created_at         TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_offers_project_offer_unique
  ON project_offers (project_id, offer_id);
CREATE INDEX IF NOT EXISTS project_offers_project_idx
  ON project_offers (project_id);

-- -------------------------------------------------------- room_subcategories
CREATE TABLE IF NOT EXISTS room_subcategories (
  id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    VARCHAR NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------- milestone_stages
CREATE TABLE IF NOT EXISTS milestone_stages (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  credit_amount REAL NOT NULL,
  category      TEXT NOT NULL DEFAULT 'additional',
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);

-- ADD COLUMN IF NOT EXISTS does not repair a pre-existing column that is
-- missing its foreign key, so add each relationship conditionally by name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_tl_id_users_id_fk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_tl_id_users_id_fk
      FOREIGN KEY (tl_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_bl_id_users_id_fk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_bl_id_users_id_fk
      FOREIGN KEY (bl_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_dm_id_users_id_fk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_dm_id_users_id_fk
      FOREIGN KEY (dm_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'line_items_subcategory_id_room_subcategories_id_fk'
  ) THEN
    ALTER TABLE line_items
      ADD CONSTRAINT line_items_subcategory_id_room_subcategories_id_fk
      FOREIGN KEY (subcategory_id) REFERENCES room_subcategories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_offers_project_id_projects_id_fk'
  ) THEN
    ALTER TABLE project_offers
      ADD CONSTRAINT project_offers_project_id_projects_id_fk
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_offers_offer_id_offers_id_fk'
  ) THEN
    ALTER TABLE project_offers
      ADD CONSTRAINT project_offers_offer_id_offers_id_fk
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'room_subcategories_room_id_rooms_id_fk'
  ) THEN
    ALTER TABLE room_subcategories
      ADD CONSTRAINT room_subcategories_room_id_rooms_id_fk
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
  END IF;
END
$$;

COMMIT;