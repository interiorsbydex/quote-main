---
name: Delete spent migration tooling once it would violate a new invariant
description: Why a one-time backfill script becomes the biggest hole in an immutability guarantee, and why guarding it is the wrong fix.
---

One-time migration routines are written to do exactly the thing a later invariant forbids:
rewrite rows in place, inside data that is now frozen. Once the migration has run
everywhere it needed to, the routine's only remaining capability is to break the
guarantee.

**The rule:** when you introduce an immutability guarantee, audit the *scripts* directory
and the maintenance helpers, not just the request-handling routes. Spent migration tooling
that can only violate the new rule should be deleted, not guarded.

**Why:** guarding it looks safer but leaves a routine whose entire documented purpose is
now unreachable — the next reader tries to make it work again. Deleting it is reversible
(version control keeps the logic, which is often subtle and worth referencing) while
leaving nothing runnable behind. Leave a short comment where it used to live saying what
it did and why it went, so its absence reads as a decision rather than an oversight.

**How to apply:** a guarantee is only proven when a repository-wide search for writes to
the protected table returns nothing outside the choke point. Encode that search as an
assertion in the verification script — a guard that covers only today's callers is not a
guarantee, and a new script added next month will not know the rule exists.
