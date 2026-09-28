---
name: GitHub repository pushes
description: Use the standard GitHub connector and Git Data API when direct git transport is unavailable in the workspace.
---

For repository publishing, the standard GitHub connector supports authenticated GitHub API writes through the `github` connector slug. The GitHub App connection may authorize successfully but still fail to provide a usable git transport or connection client in the workspace.

**Why:** Direct HTTPS and SSH pushes were unavailable even after the GitHub App connection was accepted; the standard connector successfully created blobs, a tree, a commit, and advanced the target branch.

**How to apply:** Prefer the standard GitHub connector for repository snapshots. Use the Git Data API, pace blob uploads below the workspace request limit, and verify the resulting ref and recursive tree afterward.

**Why:** GitHub’s REST paths are asymmetric for branch references, and the workspace shell callback can clip large base64 output even when its truncation flag is false.

**How to apply:** Read with `GET /git/ref/{ref}` but update with `PATCH /git/refs/{ref}`. Chunk large blob transfers before reassembling and uploading; use NUL-delimited tree listings so unusual filenames remain parseable.