---
name: Milestone credit history
description: The confirmed non-retroactive policy for Admin milestone-stage configuration.
---

Changes to an Admin-configured milestone stage apply only when a milestone is created after that change. Existing project milestones retain their saved stage name and credit amount, including after approval.

**Why:** Retrospective configuration changes would alter historical credit calculations and make project-level approval and transaction history unreliable.

**How to apply:** Treat the stage configuration as the source for new milestone creation only. Never bulk-update project milestone snapshots, credits, or transactions when an administrator changes a stage name or point value.