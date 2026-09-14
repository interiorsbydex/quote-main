---
name: Catalog sheet tab identity
description: The pricing spreadsheet's tab titles are ambiguous and duplicated. Resolve tabs by numeric gid, never by title.
---

# Resolve catalog tabs by gid, never by title

The catalog spreadsheet contains tab titles that are unsafe to match on:

- Several titles carry a trailing space or a double space.
- Two distinct tabs normalise to the same title, and they have **different column
  layouts** — one of them is stale and unused.

Because of this, name-based matching that collapses whitespace maps two different tabs
to one key, and whichever appears later in tab order silently wins. Reordering tabs in
the spreadsheet would therefore swap the catalog over to a different data set without
any error being raised.

**The rule:** pin each catalog tab by its stable numeric Google Sheets `sheetId` (gid),
stored as configuration data. Titles may be recorded for display and refreshed on sync,
but must never be the lookup key. gids survive renames and whitespace edits.

**Why:** name matching here is order-dependent and silently wrong, and the failure mode
is a catalog-wide price change with no error surfaced.

**How to apply:** whenever adding, syncing, or writing back to catalog tabs, look the tab
up by gid. Keep the set of active tabs in a config table so a new product line can be
added without a code change.

## Related: item code identity

`sheet_row_id` is a per-tab row number that restarts in every tab and shifts whenever a
row is inserted or deleted, so it is not a stable product identity. Products are
identified by an Item Code column written into the sheet.

One sheet row can expand into multiple catalog rows, because an item listing several
room types is duplicated once per room type. So an item code identifies a **sheet row**,
not a catalog row: within a version, uniqueness is (item code + room type), and all
copies sharing a code carry the same price.

## Related: the live spreadsheet has many non-catalog tabs, plus a stray Drive backup

The connected spreadsheet has far more tabs than just the catalog ones — legacy test
sheets, templates, and duplicates unrelated to pricing sit alongside the real catalog
tabs and are easy to mistake for them. A full-file Drive backup copy of the whole
spreadsheet was also made once (as a one-time safety step before a risky write) and
still exists as a separate file in Drive; it is frozen at copy time and not wired into
the app.

**Why:** someone (or an agent) can easily be looking at the wrong spreadsheet, or the
wrong tab within the right one, and conclude data is missing or wrong when it is not.

**How to apply:** when a report says a sheet is missing data the app clearly has, first
confirm which spreadsheet/tab is actually being viewed matches the app's configured
source before assuming the underlying data itself is broken.
