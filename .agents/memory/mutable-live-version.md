---
name: Making the live catalog mutable
description: What breaks when a previously frozen "live version" becomes editable in place, and the rule that follows.
---

# A version that can be rewritten invalidates every reference that resolves late

The catalog engine was built on "a published version never changes". Several features
quietly relied on that instead of storing what they needed: notably a per-quotation
product grant that stored only (item code, source version) and looked the price up at
read time. That was equivalent to a snapshot only because the source could not move.

The moment an in-place update of the live version exists, every one of those late-resolved
references silently starts tracking the new value.

**Rule:** when a record's guarantee is "this price/value is fixed from now on", copy the
value onto the record. Do not point at a row and rely on the row being immutable.

**Why:** immutability of the target is an assumption held in a different module, and it is
exactly the assumption a later feature is most likely to relax.

**How to apply:** before making any previously frozen entity editable, grep for everything
that stores a foreign key or a natural key into it *without* the value it needs, and pin
the value first. Deleting and re-inserting rows also changes their surrogate ids, so check
for anything that persists those too — transient ids passed in a single request are fine.
