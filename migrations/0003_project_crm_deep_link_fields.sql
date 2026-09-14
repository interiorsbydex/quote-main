-- CRM deep-link metadata on projects.
--
-- The Tele-CRM Tool links into this app's "Create New Project" flow with query params
-- (clientName, pid, projectType, phone, email, scope, location, estimatedValue, leadId).
-- clientName/pid/projectType already have homes. These four columns give scope,
-- location, estimatedValue, and leadId a place to land when a project is created from
-- such a link, even though they are not (yet) shown as fields in the create dialog.
--
-- Idempotent: safe to run more than once.
--
-- DEVELOPMENT ONLY. This file exists because `npm run db:push` prompts interactively for
-- an unrelated constraint on the projects table, so the dev database was given these
-- columns directly instead. The PRODUCTION database is not migrated from here: Replit's
-- publish flow diffs development against production and applies the difference itself.
-- Do not run this, or any other script, against production.

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS scope TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS estimated_value TEXT,
  ADD COLUMN IF NOT EXISTS lead_id TEXT;

COMMIT;
