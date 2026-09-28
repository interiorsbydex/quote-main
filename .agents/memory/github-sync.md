---
name: GitHub sync without Git credentials
description: Safely syncing the workspace snapshot through the connected GitHub API when the shell Git remote cannot authenticate.
---

When `origin` is configured but direct Git fetch or push rejects authentication, the connected GitHub integration may still have repository access. A safe content sync can create a new commit based on the current GitHub branch, overlay the tracked workspace blobs, refuse to remove remote-only files, verify the complete tree, and move the branch without force.

This only aligns file content. It does not make the workspace branch descend from the new GitHub commit or restore ordinary shell Git authentication; handle branch-history alignment as a separate follow-up.

**Why:** The project’s GitHub connection had repository access while `git fetch origin` rejected authentication. The API-based update succeeded, but the workspace and GitHub commit histories remained separate despite identical trees.

**How to apply:** Use this approach only when managed Git authentication is unavailable and the user requested a repo sync. Verify the latest remote tip immediately before updating it, preserve remote-only files, and report any remaining local branch divergence.