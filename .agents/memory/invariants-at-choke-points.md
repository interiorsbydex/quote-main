---
name: Enforce record invariants at a choke point, not at the main route
description: Why a "every record must have X" rule has to be enforced where records are created, and how the rarely-used creation path is the one that breaks it.
---

When a system depends on every new record carrying some field — a quotation pinned to a
pricing version, a row tagged with a tenant, an event stamped with a source — the rule holds
only as well as the *least-used* code path that creates that record. The main route gets the
attention and the tests. The admin importer, the "create from spreadsheet" button, the
seed script and the duplicate action are the ones that quietly insert a bare row.

**The rule:** put the invariant inside a single creation helper and make every path go
through it. Where a generic helper must stay generic, have it fill the field in when the
caller did not supply one, so forgetting produces correct behaviour rather than a silent
hole. Reserve the explicit-value branch for callers with a genuine reason to differ — a
duplicated record inheriting its original's version, for example, rather than jumping to
whatever is current.

**Why:** an unpinned record usually looks completely fine at creation time. The damage
surfaces much later, on the next publish or migration, when it silently adopts new values.
By then it is indistinguishable from a legitimate record, and there is nothing in the data
that says which behaviour was intended.

**How to apply:** before declaring such a guarantee complete, grep for every insert into the
table rather than reading the obvious route. Each hit must either be the helper itself or a
caller passing the field deliberately. A count of offending rows that reads zero today
proves nothing about the paths — a rarely used route simply may not have run yet. Cover the
paths in a test that distinguishes *inherited* from *stamped-current*, since a test that
only checks "not null" passes even when the wrong value is filled in.
