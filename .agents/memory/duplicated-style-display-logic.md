---
name: Duplicated style/category display logic
description: The multiStyleEnabled/defaultCategory (and room.category) display ternary is hand-copied across several unrelated files instead of shared; relevant when investigating any "wrong style/category shown" bug.
---

The project's style label (`multiStyleEnabled ? "MSP" : defaultCategory`, prefix
"DeX - " stripped for friendly display) and the room-level style override
(`room.category || project.defaultCategory`) are each re-implemented inline,
per call site, rather than through a shared helper. Known call sites as of
this writing: the Dashboard project-card badge, AdminDashboard's project row
(uses "Multi-Style" instead of "MSP" — inconsistent wording), PrintableQuotation.tsx
(client-side quotation preview), the server PDF-generation route in
server/routes.ts, and the public share-link endpoint (`/api/shared/:shareToken`,
returns raw `defaultCategory` with no MSP handling, but the field happens to be
unused by the SharedQuote.tsx frontend today).

**Why:** a bug report like "shows DeX - Xpress instead of MSP" can look
unreproducible if you only check the one file you most recently edited — the
correct-looking fix in one place doesn't mean the other four copies agree.
Conversely, don't assume a display bug exists just because the underlying
data field is duplicated; trace to the exact rendering path the user actually
looked at.

**How to apply:** when asked to fix or verify a style/category display bug,
grep for `multiStyleEnabled` and `\.category` across `client/src` and
`server/routes.ts` and check every hit, not just the most obvious page. Prefer
extracting a shared helper if you touch more than one of these sites in the
same change.
