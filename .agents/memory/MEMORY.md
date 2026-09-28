# Memory index

- [Database environments](database-environments.md) — DATABASE_URL is dev, NEON_DATABASE_URL is production; they hold different data. Check before any migration or "live" figure.
- [Catalog sheet tab identity](catalog-sheet-tabs.md) — the pricing spreadsheet has tabs whose titles differ only by whitespace, plus a duplicate; always resolve tabs by numeric gid.
- [Testing authenticated endpoints](testing-authenticated-endpoints.md) — the session cookie is Secure; scripts must log in via the https dev domain or the cookie is silently dropped.
- [Matching catalog rows across versions](version-item-matching.md) — match by content, never sheet position; the key must include material_type/brand/panel_type, and must exclude price.
- [Verifying a live system](verifying-live-systems.md) — on a system in daily use, totals drift legitimately; verify per-row against a snapshot, and compare numerically not as text.
- [Proving a guarantee in production](proving-guarantees-in-production.md) — smallest real divergence through the deployed API, restore via trap, then delete the test artifacts.
- [Invariants at choke points](invariants-at-choke-points.md) — "every record must have X" breaks on the rarely-used create path; enforce in one helper and grep every insert.
- [Promised vs shipped](promised-vs-shipped.md) — a pre-build design doc is intent, not documentation; grep for the route before telling anyone a feature exists.
- [Retiring migration tooling](retiring-migration-tooling.md) — spent one-time backfills are the biggest hole in a new immutability rule; delete them rather than guard them.
- [Production schema changes](production-schema-changes.md) — publish applies the dev-vs-prod diff; never hand-apply DDL to production. Diff the two catalogs before saying a release is safe.
- [Catalog item-code identity](catalog-item-code-identity.md) — "row missing/stale" often reduces to a duplicated sheet Item Code, not version-pinning; check for a duplicate before explaining by-design behavior.
- [Making the live catalog mutable](mutable-live-version.md) — once a frozen version can be edited in place, every late-resolved reference to it must pin its value instead.
- [Blank attribute defaults](blank-attribute-defaults.md) — a blank room type means "any room"; defaulting it on the read path silently hides half the catalog from the other room.
- [Version pinning hides new items](version-pinning-vs-new-items.md) — a pinned record never sees items added later; it looks like a permissions bug. Ignore the stamp on reads in single-catalog mode.
- [Stale state in dialog-confirm mutations](stale-state-dialog-mutations.md) — a mutationFn reading target state at call time can silently get the reset value when a Radix AlertDialogAction's auto-close races the mutation; pass the id as a mutate() argument instead.
- [Catalog codes with room variants](catalog-code-room-variants.md) — one item code may map to separate Dry and Wet rows; project exceptions must preserve every variant, never select an arbitrary row.
- [GitHub sync without Git credentials](github-sync.md) — a connected GitHub API can update the repo when shell Git auth fails, but content sync does not reconcile local branch history.
