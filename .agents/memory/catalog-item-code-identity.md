---
name: Item-code identity is the real failure mode behind "new row not showing"
description: When a catalog row seems to vanish or show stale data, check for a duplicate item code before reaching for version-pinning/exception explanations.
---

# A duplicated item code masquerades as version-pinning or stale-line-item bugs

In this catalog system, every product's cross-version identity is its Item Code
(column N in the price sheet). Pricing-version diffs, publish, and the per-project
"add newer product" exception grant are all keyed by item code. When someone
duplicates an existing sheet row to create a new product (a very natural way to add a
similar item), the copy carries the original's item code along with it unless it is
explicitly cleared. Two products sharing one code then collide in every code path that
looks products up by code — one becomes unreachable or shows the other's data,
depending on which row a `.limit(1)`-style lookup happens to return.

**Why this matters for debugging:** the visible symptom ("a new row doesn't appear",
"an old row shows stale text") looks exactly like the *intentional* version-pinning /
frozen-line-item behavior this system also has by design. It is easy to spend a long
time explaining the by-design behavior before checking whether the sheet itself has a
plain data-entry duplicate. The sync process only emits a warning for a duplicate
item code (buried among hundreds of unrelated "missing code" warnings) — it does not
block the sync, so nothing forces anyone to notice.

**How to apply:** when a catalog row is reported missing or stale, check the sheet's
Item Code column for a duplicate on the affected rows before investigating
version-pinning or line-item-snapshot logic. Fix by clearing the duplicate cell in the
sheet and re-running "Generate Item Codes" (it only fills blanks, never overwrites a
non-empty code), then re-sync and publish.
