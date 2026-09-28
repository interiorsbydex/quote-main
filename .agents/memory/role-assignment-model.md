---
name: Role assignment model
description: The confirmed relationship between TL/BL/DM project assignments and PD/DTL cohorts.
---

Projects can optionally name a TL, BL, and DM. These assignments are not accepted from the public project-creation payload. Admins manage them from project details, while a project created by a logged-in TL is server-assigned to that same TL so it remains visible on their assignment-based dashboard. `N/A` means no person is assigned.

PD and DTL are cohorts of Team Leads only. A quotation's cohort is derived from its assigned TL, never stored separately on the project.

**Why:** Role dashboards query the dedicated assignment columns, not project ownership. Leaving `tlId` blank on a TL-created project makes it visible to Admin but invisible to its creator.

**How to apply:** Keep role visibility based on the matching project assignment. Any future project-creation path available to TL users must set their `tlId` server-side. When displaying or filtering by cohort, resolve it through the assigned TL; do not add a project cohort field.