#!/usr/bin/env bash
set -euo pipefail

# This hook runs after task merges in the development/staging Repl.
# Keep every command non-interactive because the runner closes stdin.

npm install --no-audit --no-fund --ignore-scripts
npm run db:push -- --force
npm run check
npm run build