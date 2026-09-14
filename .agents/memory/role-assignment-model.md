---
name: Role assignment model
description: The confirmed relationship between TL/BL/DM project assignments and PD/DTL cohorts.
---

Projects can optionally name a TL, BL, and DM. These are individual role assignments made from existing project details, not fields in project creation. `N/A` means no person is assigned.

PD and DTL are cohorts of Team Leads only. A quotation's cohort is derived from its assigned TL, never stored separately on the project.

**Why:** The confirmed model avoids duplicated cohort data and prevents project and Team Lead cohort labels from drifting out of sync.

**How to apply:** Keep role visibility based on the matching project assignment. When displaying or filtering a project by cohort, resolve it through the assigned TL's cohort. Do not add a separate project cohort field.