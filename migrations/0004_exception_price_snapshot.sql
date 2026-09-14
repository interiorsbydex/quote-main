-- Pin the price of a per-quotation product at the moment it is granted.
--
-- Until now an exception stored only (item_code, source_version_id) and its price was
-- resolved live from that version's catalog rows. That was safe while every published
-- version was frozen. It stops being safe once the live version can be updated in place
-- ("Update live price list"): an exception granted from the live version would silently
-- follow later corrections to it, contradicting the promise that the granted price stays
-- fixed on that quotation.
--
-- The price is therefore copied onto the exception itself when it is granted, and the
-- catalog row is used only for the product's description and attributes.
--
-- Idempotent: safe to run more than once.
--
-- DEVELOPMENT ONLY. The PRODUCTION database is not migrated from here: Replit's publish
-- flow diffs development against production and applies the difference itself.

BEGIN;

ALTER TABLE project_catalog_exceptions
  ADD COLUMN IF NOT EXISTS granted_rate          REAL,
  ADD COLUMN IF NOT EXISTS granted_selling_price REAL;

-- Backfill existing grants from what they resolve to right now. Done before any in-place
-- update can move those prices, so each one keeps exactly the price it has today.
UPDATE project_catalog_exceptions e
SET granted_rate = (
      SELECT ci.rate FROM catalog_items ci
      WHERE ci.pricing_version_id = e.source_version_id AND ci.item_code = e.item_code
      LIMIT 1
    ),
    granted_selling_price = (
      SELECT ci.selling_price FROM catalog_items ci
      WHERE ci.pricing_version_id = e.source_version_id AND ci.item_code = e.item_code
      LIMIT 1
    )
WHERE e.granted_rate IS NULL AND e.granted_selling_price IS NULL;

COMMIT;
