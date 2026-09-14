#!/usr/bin/env bash
#
# Proves that no quotation data which existed before the rollout has changed.
#
# It compares the live tables against the pre-rollout pg_dump itself, column for column,
# rather than against a hand-picked subset of fields. Both sides are rendered by Postgres
# in the same COPY text format, so the comparison is a plain line diff -- there is no
# custom parsing or numeric formatting to get wrong.
#
#   a pre-rollout row missing from live  -> it was changed or deleted  -> FAIL
#   a live row absent from the dump      -> new quoting activity       -> expected
#
# Counting rows is deliberately NOT the check: staff keep quoting while the rollout runs,
# so totals drift legitimately and a real change could hide in that drift.
#
# Columns added by the migration are excluded automatically, by asking the dump which
# columns existed beforehand and selecting exactly those from the live table.
#
# Usage: scripts/verify-quotes-unchanged.sh [path-to-dump]

set -euo pipefail

DUMP="${1:-backups/prod-before-rollout.dump}"

# Defaults to production explicitly rather than following whatever DATABASE_URL happens to
# be, so this cannot silently verify the wrong database and report a comforting PASS.
# VERIFY_DB_URL exists so the checker itself can be rehearsed against development.
TARGET_URL="${VERIFY_DB_URL:-${NEON_DATABASE_URL:?NEON_DATABASE_URL must be set}}"

[ -f "$DUMP" ] || { echo "No such dump: $DUMP" >&2; exit 1; }

host=$(printf '%s' "$TARGET_URL" | sed -E 's#.*@([^/:]+).*#\1#')
if [ "$TARGET_URL" = "${NEON_DATABASE_URL:-}" ]; then
  echo "Verifying against PRODUCTION host $host"
else
  echo "Verifying against NON-PRODUCTION host $host (rehearsal)"
fi
echo "Baseline: $DUMP"
echo

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

status=0
verified=0
for tbl in projects rooms line_items; do
  # pg_restore needs an explicit -f - to write to stdout; without it, it fails and the
  # table would silently verify nothing.
  pg_restore --data-only --table="$tbl" -f - "$DUMP" > "$tmp/raw" 2>"$tmp/err" || {
    echo "  $tbl: FAIL - could not extract from dump: $(head -1 "$tmp/err")"
    status=1
    continue
  }

  # The dump's COPY header lists the columns as they existed before the migration.
  header=$(grep -m1 '^COPY ' "$tmp/raw" || true)
  if [ -z "$header" ]; then
    echo "  $tbl: FAIL - no data found in dump, cannot verify"
    status=1
    continue
  fi
  cols=$(printf '%s' "$header" | sed -E 's/^COPY [^(]*\(([^)]*)\).*/\1/')

  awk '/^COPY /{f=1;next} /^\\\.$/{f=0} f' "$tmp/raw" | LC_ALL=C sort > "$tmp/before"
  psql "$TARGET_URL" -q -c "\copy (SELECT $cols FROM $tbl) TO STDOUT" \
    | LC_ALL=C sort > "$tmp/after"

  before=$(wc -l < "$tmp/before")
  after=$(wc -l < "$tmp/after")

  # An empty baseline would make every comparison below pass vacuously.
  if [ "$before" -eq 0 ]; then
    echo "  $tbl: FAIL - baseline extracted 0 rows, cannot verify"
    status=1
    continue
  fi

  verified=$((verified + 1))
  # Written to files rather than piped into head: under `pipefail`, head closing the pipe
  # early raises SIGPIPE and the script would exit 141 instead of reporting pass or fail.
  LC_ALL=C comm -23 "$tmp/before" "$tmp/after" > "$tmp/gone"
  LC_ALL=C comm -13 "$tmp/before" "$tmp/after" > "$tmp/added"
  gone=$(wc -l < "$tmp/gone")
  added=$(wc -l < "$tmp/added")

  printf '  %-12s before=%-7s live=%-7s unchanged=%-7s CHANGED/DELETED=%-5s added=%s\n' \
    "$tbl" "$before" "$after" "$((before - gone))" "$gone" "$added"

  if [ "$gone" -ne 0 ]; then
    status=1
    echo "    first few pre-existing rows that no longer match:"
    cut -c1-150 < "$tmp/gone" | sed -n '1,3p' | sed 's/^/      /'
  fi
done

echo
# "Nothing was checked" must never read as success.
if [ "$verified" -eq 0 ]; then
  echo "FAIL - no table could be verified. This is not a pass."
  exit 1
fi
if [ "$status" -eq 0 ]; then
  echo "PASS - all $verified tables: every row that existed before the rollout is unchanged, in every column."
else
  echo "FAIL - pre-existing data moved. Do not proceed; roll back."
fi
exit "$status"
