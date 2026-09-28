---
name: Header-driven catalog tabs
description: Durable master-data convention for new Google Sheet catalog categories.
---

New catalog categories such as Furniture must resolve their source tab by its numeric Google Sheets gid and map their fields by normalized header names, never by a fixed sheet position. The master sheet is the Admin-managed source of option values.

**Why:** Teams edit spreadsheets manually and can add values or rearrange columns. Header mapping prevents a harmless column order change from silently assigning the wrong price or product property.

**How to apply:** Keep established header names stable, make dropdown values data-driven from the synced rows, and use a boolean `Active` checkbox for row availability. When adding a new sheet field, carry it through both the sync parser and the catalog-response mapper; use unformatted Sheet values for currency so formatting cannot truncate precision. Sheet edits enter the application through the normal sync-and-publish flow; they do not rewrite historical quote versions.