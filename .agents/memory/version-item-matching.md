---
name: Matching catalog rows across versions
description: Never match spreadsheet-derived rows across two points in time by row position. Use content keys with an ambiguity guard.
---

# Match rows by content, never by sheet position

When reconciling two snapshots of a spreadsheet-derived catalog — for example giving
stable item codes to a historical version that predates them — match on **content**
(category + description + unit + room type), not on the sheet row number.

**Why:** row number is only meaningful within a single sync. Any row inserted or
deleted in the spreadsheet shifts every row beneath it, so a position match assigns each
item its neighbour's identity. The failure is silent and looks plausible: the resulting
price comparison shows a long list of large, entirely fabricated price swings, where
each item's "new" price is actually the previous item's old price. A tell-tale sign is a
diff where consecutive rows' new values equal the preceding rows' old values.

**How to apply:** build the match key from content columns, count occurrences of the key
on both sides with a window function, and accept only keys that are unique on both
sides. Leave ambiguous rows unmatched and report the count rather than guessing —
an unmatched row can be excluded from comparisons safely, whereas a wrongly matched one
corrupts every downstream decision.

The same reasoning applies to any cross-version operation keyed on identity: prefer an
explicit stable code stored in the source of truth, and treat position as a rendering
detail only.

## The content key must include the columns that actually distinguish products

Category + description + unit + room type is **not** enough for this catalog. Hundreds of
distinct products share all four and differ only in `material_type` (finish and colour —
"Smooth" vs "Glossy" vs "Designer Lam", "Black or Silver" vs "Gold or Rose Gold"), and
sometimes `brand` or `panel_type`.

**Why:** a key that omits them does not mismatch rows — the ambiguity guard prevents that
— it makes whole families of rows look ambiguous and silently skips them. The damage is
downstream and easy to miss: every skipped row stays without an identity, so it can never
be compared, and it resurfaces as a phantom "new item" in every future price-change
preview. Noise like that teaches the user to stop trusting the diff.

**How to apply:** run progressively looser passes, each touching only what earlier passes
left unmatched, and report per-pass counts so the result can be audited. Rows identical in
every column *including price* are genuinely interchangeable, so pairing them in a stable
order is safe — but only once price is part of the comparison, otherwise the pairing can
join a row to a differently priced one and invent a price change. No pass may reuse an
identity already assigned within the target version, or two rows collapse onto one.

Verify the outcome structurally rather than trusting the passes: the version built from
the source of truth defines the correct set of identities, so assert that the backfilled
version mirrors it exactly, and fail loudly if it does not.

**Keep price out of the primary key.** Versioning exists because prices change, so a
matcher keyed on price stops matching an item at exactly the moment it is repriced. Use
price only to separate rows already known to be otherwise identical.
