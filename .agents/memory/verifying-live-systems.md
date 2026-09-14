---
name: Verifying a change against a live, in-use system
description: Why aggregate totals are the wrong safety check on a production system people are using, and the two false signals that waste a rollout.
---

# Verify per row, not by totals

When proving that a migration or backfill did not disturb existing data on a system that
people are actively using, do not compare counts or `SUM()` before and after.

**Why:** staff keep working during the rollout. A new quotation legitimately changes every
aggregate, so a total that moved proves nothing and a total that held is luck. Worse, the
check fails in the direction that wastes the most time: it reports a violation for normal
business activity, which invites the operator to wave it through — and a genuinely
corrupted row can hide inside that same drift.

**How to apply:** snapshot the identifying and value columns of every row to a file first
(`\copy (SELECT id, ...) TO ... CSV`). Afterwards, join live data back to the snapshot on
the primary key and assert that every row present beforehand is unchanged. Report rows
added since separately and treat them as expected, not as errors. Deleted or altered
pre-existing rows are the only failures.

## Two false signals that will cost a rollout

1. **Scientific notation.** These money columns are `real`. `psql` exports some values as
   `1.365e+06` while the Node driver returns `1365000`. A string comparison flags that as
   a change. Compare numerically.
2. **A guard that never fires.** A script that writes to production by way of an
   overridden `DATABASE_URL` fails silently in both directions — hitting production when
   you meant to rehearse, and hitting development while believing you migrated production,
   where "nothing changed" reads as success. State the target host and database before
   every write, require the operator to declare intent, and *test that the guard actually
   refuses* before trusting it.

## Prove the checker can fail before you believe it passes

A safety check is worthless until it has been seen to fail. Rehearse it: take a dump of a
non-production database, run the checker (expect pass), change one row by one unit, run it
again (expect fail), revert, run again (expect pass).

**Why:** this was not hypothetical. A first version of the check reported "PASS" while
silently verifying *nothing* — `pg_restore` needs an explicit `-f -` to write to stdout,
and without it every table extraction errored into a suppressed stderr and was skipped. A
second version compared a development dump against the production database because one
connection string was left un-parameterised. Both looked like clean passes.

**How to apply:** make "nothing was checked" an explicit failure, never a silent success —
count what was actually verified and fail if the count is zero. Never let a skipped or
errored step fall through to the success path. Under `set -o pipefail`, do not pipe into
`head`; the early close raises SIGPIPE and the script exits 141, which is neither pass nor
fail. Write to a file and read from it instead.
