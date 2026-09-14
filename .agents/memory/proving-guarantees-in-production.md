---
name: Proving a guarantee on a live system
description: How to demonstrate a safety guarantee against real production data without risking real harm, and how to leave no residue behind.
---

A guarantee that has only been demonstrated in development is not yet proven. The
production data, the deployed build, and the caches are all different. Prove it where it
counts — but size the experiment so the worst case is trivial.

**The pattern:** make the smallest change that still creates a genuine divergence, exercise
it through the real deployed HTTP API rather than by calling internal functions, verify
immediately, then revert. For a price catalog that meant raising one item by one rupee: a
one-rupee difference is as convincing a divergence as a ten-percent one, and if a member of
staff happens to transact against that item during the few seconds the test is live, the
worst possible consequence is one rupee.

**Why the real API and not the internal module:** calling the module directly proves the
library works, not that the thing users touch works. Going through the deployed endpoint
covers routing, authentication, caching, and cache invalidation on publish — the parts most
likely to be wrong.

**Guard the window with a trap, not with care.** Wrap the experiment so that any failure,
including an assertion failure partway through, restores the previous state on the way out.
Do not rely on reaching the cleanup lines at the bottom of the script.

**Clean up so the business history stays meaningful.** Test versions, temporary admin
accounts, and their audit entries are artifacts of the exercise, not business events.
Remove them, and check first that nothing real points at them. Confirm the deletion is
genuinely safe rather than assumed — cascade rules decide whether removing a parent quietly
deletes children or nulls a reference on live records. Record what was done in a durable
document instead of leaving debris in the product.

**Watch for fields that do not round-trip.** Verification that matches records by their
descriptive fields can silently find nothing when a serving layer substitutes defaults for
blank values, so a match key must be built from fields that survive the round trip. Make
"found nothing to compare" a loud failure, never a pass — see
[verifying-live-systems](verifying-live-systems.md).
