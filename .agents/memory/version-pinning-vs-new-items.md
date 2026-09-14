---
name: Version pinning hides new items
description: Why a per-record "version stamp" makes newly added catalog items invisible, and when the stamp must be ignored
---

A record pinned to a version reads that version forever. The moment a *new* item is added
to the current version, every pinned record silently lacks it — and the symptom never looks
like versioning. It looks like a permissions bug ("only admins can see the new item"),
because who sees it depends on which record they happened to open, and admins tend to be
the ones creating fresh records.

**Rule:** whenever a "one catalog for everyone" mode exists, the version stamp must be
ignored on the *read* path in that mode, not merely unused for new records. Repointing the
stamps, or telling people to recreate their records, treats the symptom.

**Why:** pinning exists so quoted prices cannot move. That guarantee is carried by the
saved rows themselves (each line stores its own rate and amount), not by the stamp — so
ignoring the stamp when choosing *what can be added next* costs nothing and fixes the
invisibility.

**How to apply:**
- A read that resolves "which version does this record use" must consult the mode switch,
  and every endpoint that reports the version to the UI must resolve it the same way, or
  the badge will name a list the user is not being served.
- Read the mode switch *fresh*, not from a per-process cache — with several server
  processes, two requests seconds apart otherwise get opposite policies.
- Once the base catalog becomes the live one, per-record "granted extras" can collide with
  it. Deduplicate by stable item code and let the granted row win: it carries the price
  that was actually promised.
- Client caches matter too: a version badge with a stale window will disagree with a
  catalog fetched fresh.

**Diagnosis shortcut:** before believing a role-based explanation, compare the version
stamps of the records involved, not the roles of the people reporting it.
