-- Admin-flippable switches.
--
-- The first one is `instant_sync`: while it is on, refreshing from the Google Sheet puts
-- the new prices in front of everyone straight away, exactly as the app behaved before
-- pricing versions existed. Turning it off restores the review-first workflow (sync fills
-- the Draft, an admin applies or releases it).
--
-- It is seeded ON because the team is not adopting the review workflow yet.
--
-- Idempotent: safe to run more than once.
--
-- DEVELOPMENT ONLY. The PRODUCTION database is not migrated from here: Replit's publish
-- flow diffs development against production and applies the difference itself.

BEGIN;

CREATE TABLE IF NOT EXISTS app_settings (
  key        VARCHAR PRIMARY KEY,
  value      TEXT      NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by VARCHAR            REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO app_settings (key, value)
VALUES ('instant_sync', 'true')
ON CONFLICT (key) DO NOTHING;

COMMIT;
