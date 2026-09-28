---
name: Catalog item codes with room variants
description: Why one stable item code can legitimately resolve to multiple catalog rows and how quotation exceptions must handle it.
---

A stable item code may appear on more than one row in the same pricing version when the
same product is expanded into separate normalized room-type variants. Treat the code as
product identity, not as a guarantee that a query should return exactly one row.

**Why:** multi-room sheet entries are normalized into separate Dry and Wet records. A
quotation exception that selected an arbitrary single row made the product disappear when
the room filter requested the other variant.

**How to apply:** any read that resolves a quotation exception by item code must retain all
matching source rows, then apply category and room filters normally. Snapshot prices may be
shared by the variants, but room-type metadata must not be collapsed with `LIMIT 1`.