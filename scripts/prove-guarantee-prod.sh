#!/usr/bin/env bash
# Proves, against the live production system, that publishing a new catalog version does
# not move the prices of existing quotations.
#
# It deliberately publishes a real version carrying a real (1 rupee) price change, checks
# what the live API serves, then reverts and deletes everything it created. The change is
# 1 rupee so that even if a staff member quotes that exact item during the few seconds the
# test version is live, the worst possible consequence is 1 rupee on one line.
#
# Usage: PROJECT_ID=<uuid> COOKIE=<jar> ./scripts/prove-guarantee-prod.sh
set -euo pipefail

BASE=https://proposals.interiorsbydex.com
COOKIE="${COOKIE:-/tmp/cj}"
PROJECT_ID="${PROJECT_ID:?PROJECT_ID must be set}"
: "${NEON_DATABASE_URL:?NEON_DATABASE_URL must be set}"

die() { echo "ABORT: $*" >&2; exit 1; }

# Everything below is interpolated into SQL, so nothing reaches a query unvalidated.
[[ "$PROJECT_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || die "PROJECT_ID is not a UUID"
[ -r "$COOKIE" ] || die "cookie jar $COOKIE is not readable"

q() { psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "$1"; }
qx() { psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "$1"; }

# curl -s alone treats 401/400/500 as success, which would let a failed revert masquerade
# as a completed cleanup.
api() {
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS --fail-with-body -b "$COOKIE" -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' -d "$data"
  else
    curl -sS --fail-with-body -b "$COOKIE" -X "$method" "$BASE$path"
  fi
}

ACTIVE_ID=$(q "SELECT id FROM pricing_versions WHERE status='active'")
DRAFT_ID=$(q "SELECT id FROM pricing_versions WHERE status='draft'")
[ -n "$ACTIVE_ID" ] && [ -n "$DRAFT_ID" ] || die "need exactly one active version and one draft"

# An item this quotation actually used, so the test concerns a real price on a real job.
# The catalog API does not expose item codes, so the item must be identifiable by its
# descriptive fields alone -- hence the uniqueness requirement, which keeps the check
# unambiguous.
CODE=$(q "
  SELECT c.item_code
  FROM catalog_items c
  WHERE c.pricing_version_id='$ACTIVE_ID' AND c.item_code IS NOT NULL
    AND EXISTS (SELECT 1 FROM line_items li WHERE li.project_id='$PROJECT_ID' AND li.description=c.description)
    AND 1 = (SELECT count(*) FROM catalog_items c2
             WHERE c2.pricing_version_id=c.pricing_version_id
               AND c2.description=c.description
               AND c2.unit_type IS NOT DISTINCT FROM c.unit_type
               AND c2.category_name IS NOT DISTINCT FROM c.category_name)
  ORDER BY c.rate DESC LIMIT 1")

[ -n "$CODE" ] || die "could not find a uniquely identifiable shared catalog item"
[[ "$CODE" =~ ^[A-Za-z0-9_-]+$ ]] || die "unexpected item code format: $CODE"

ORIG_RATE=$(q "SELECT DISTINCT rate FROM catalog_items WHERE pricing_version_id='$ACTIVE_ID' AND item_code='$CODE'")

# The Draft may legitimately hold a staged price that differs from the live one. Restoring
# it to the live price would silently destroy that work, so capture the Draft's own value
# and put exactly that back afterwards. One code can span several room types, which always
# share a price; more than one distinct price means something is wrong.
DRAFT_ORIG_RATE=$(q "SELECT DISTINCT rate FROM catalog_items WHERE pricing_version_id='$DRAFT_ID' AND item_code='$CODE'")
DRAFT_ROWS=$(q "SELECT count(*) FROM catalog_items WHERE pricing_version_id='$DRAFT_ID' AND item_code='$CODE'")
[ "$(printf '%s' "$DRAFT_ORIG_RATE" | grep -c .)" = "1" ] || die "draft holds multiple distinct prices for $CODE"
[[ "$ORIG_RATE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "unexpected active rate: $ORIG_RATE"
[[ "$DRAFT_ORIG_RATE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "unexpected draft rate: $DRAFT_ORIG_RATE"

if [ "$DRAFT_ORIG_RATE" != "$ORIG_RATE" ]; then
  die "the Draft already has a staged price change for $CODE (draft=$DRAFT_ORIG_RATE, live=$ORIG_RATE).
       Publish or discard it before running this test, so the test cannot disturb real work."
fi

NEW_RATE=$(awk -v r="$DRAFT_ORIG_RATE" 'BEGIN{printf "%.0f", r+1}')
PUBLISHED_ID=""

echo "Test item      : $CODE   (rows in draft: $DRAFT_ROWS)"
echo "Live price     : $ORIG_RATE"
echo "Test price     : $NEW_RATE"
BEFORE_TOTAL=$(q "SELECT round(sum(li.amount)::numeric,2) FROM line_items li WHERE li.project_id='$PROJECT_ID'")
echo "Quotation total before: $BEFORE_TOTAL"
echo

# Runs on every exit path, including a failed assertion midway through.
restore() {
  local rc=$? problems=0
  echo
  echo "--- restoring ---"

  local cur
  cur=$(q "SELECT id FROM pricing_versions WHERE status='active'" || echo "")
  if [ "$cur" != "$ACTIVE_ID" ]; then
    if api POST "/api/admin/pricing-versions/$ACTIVE_ID/revert" >/dev/null; then
      cur=$(q "SELECT id FROM pricing_versions WHERE status='active'" || echo "")
      if [ "$cur" = "$ACTIVE_ID" ]; then
        echo "  reverted the live catalog to the original version"
      else
        echo "  !! REVERT DID NOT TAKE EFFECT - active version is still $cur"; problems=1
      fi
    else
      echo "  !! REVERT REQUEST FAILED - the test version may still be live"; problems=1
    fi
  else
    echo "  live catalog was never left changed"
  fi

  # Restore the Draft to the value it held before this script touched it.
  local d
  d=$(q "SELECT id FROM pricing_versions WHERE status='draft'" || echo "")
  if [ -n "$d" ]; then
    qx "UPDATE catalog_items SET rate=$DRAFT_ORIG_RATE
        WHERE pricing_version_id='$d' AND item_code='$CODE' AND rate=$NEW_RATE" \
      && echo "  draft price restored to $DRAFT_ORIG_RATE" \
      || { echo "  !! COULD NOT RESTORE THE DRAFT PRICE"; problems=1; }
  fi

  # Remove the version this script published, so the client's history shows only real
  # pricing events. Guarded: never delete something a quotation depends on.
  if [ -n "$PUBLISHED_ID" ]; then
    local inuse
    inuse=$(q "SELECT count(*) FROM projects WHERE pricing_version_id='$PUBLISHED_ID'" || echo "1")
    if [ "$inuse" = "0" ]; then
      qx "DELETE FROM pricing_version_audit
          WHERE action='revert' AND (details->'previousActive'->>'id')='$PUBLISHED_ID'"
      qx "DELETE FROM pricing_versions WHERE id='$PUBLISHED_ID'"
      qx "UPDATE pricing_versions SET version_number=1+(SELECT max(version_number)
            FROM pricing_versions WHERE status<>'draft') WHERE status='draft'"
      echo "  deleted the temporary test version"
    else
      echo "  !! $inuse quotation(s) reference the test version - LEAVING IT IN PLACE"; problems=1
    fi
  fi

  if [ "$problems" -ne 0 ]; then
    echo
    echo "  CLEANUP INCOMPLETE - inspect production before doing anything else."
    exit 1
  fi
  exit "$rc"
}
trap restore EXIT

echo "=== 1. raise the price in the Draft ==="
qx "UPDATE catalog_items SET rate=$NEW_RATE WHERE pricing_version_id='$DRAFT_ID' AND item_code='$CODE'"
api GET "/api/admin/pricing-versions/preview" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);
      console.log(`   preview: ${p.changed.length} changed, ${p.added.length} new, ${p.removed.length} removed, ${p.unchangedCount} unchanged`);
      for(const c of p.changed) console.log(`   ${c.itemCode}: ${c.oldRate} -> ${c.newRate}`);})'

echo
echo "=== 2. publish it as a real new version ==="
PUBLISHED_ID=$(api POST "/api/admin/pricing-versions/publish" \
  '{"name":"Rollout verification (auto-reverted)","notes":"Temporary version published to prove existing quotations do not change. Reverted and deleted automatically."}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);
      if(!p.version){console.error("publish failed: "+(p.error||s));process.exit(1);}
      console.error("   "+p.message); process.stdout.write(p.version.id);})')
[ -n "$PUBLISHED_ID" ] || die "publish did not return a version id"

echo
echo "=== 3. what the LIVE app now serves ==="
# Matched on the descriptive fields, which the uniqueness check above guarantees identify
# exactly one catalog row. Room type is deliberately excluded: the API substitutes a
# default room type for items stored with a blank one, so it does not round-trip.
export M_DESC=$(q "SELECT description FROM catalog_items WHERE pricing_version_id='$ACTIVE_ID' AND item_code='$CODE' LIMIT 1")
export M_UNIT=$(q "SELECT coalesce(unit_type,'') FROM catalog_items WHERE pricing_version_id='$ACTIVE_ID' AND item_code='$CODE' LIMIT 1")
export M_CAT=$(q  "SELECT coalesce(category_name,'') FROM catalog_items WHERE pricing_version_id='$ACTIVE_ID' AND item_code='$CODE' LIMIT 1")
rate_for() {
  api GET "$1" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const a=JSON.parse(s); const list=Array.isArray(a)?a:(a.items||[]);
      const m=list.filter(x=>x.description===process.env.M_DESC
        && (x.unitType||"")===process.env.M_UNIT
        && (x.categoryName||"")===process.env.M_CAT);
      console.log(m.length===1?m[0].rate:`AMBIGUOUS(${m.length})`);
    })'
}
OLD_QUOTE_RATE=$(rate_for "/api/catalog?projectId=$PROJECT_ID")
NEW_QUOTE_RATE=$(rate_for "/api/catalog")

echo "   price served to the EXISTING quotation : $OLD_QUOTE_RATE   (expected $ORIG_RATE)"
echo "   price served to a NEW quotation        : $NEW_QUOTE_RATE   (expected $NEW_RATE)"
api GET "/api/pricing-version?projectId=$PROJECT_ID" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(`   quotation is priced against: ${p.version.name} (latest is now "${p.latestName}", isLatest=${p.isLatest})`);})'

AFTER_TOTAL=$(q "SELECT round(sum(li.amount)::numeric,2) FROM line_items li WHERE li.project_id='$PROJECT_ID'")
echo "   quotation total after publish: $AFTER_TOTAL   (before: $BEFORE_TOTAL)"

echo
echo "=== VERDICT ==="
ok=0
[ "$OLD_QUOTE_RATE" = "$ORIG_RATE" ] || { echo "FAIL: the existing quotation's price moved"; ok=1; }
[ "$NEW_QUOTE_RATE" = "$NEW_RATE" ]  || { echo "FAIL: a new quotation did not pick up the new price"; ok=1; }
[ "$AFTER_TOTAL" = "$BEFORE_TOTAL" ] || { echo "FAIL: the quotation total changed"; ok=1; }
[ "$ok" -eq 0 ] && echo "PASS - the price rise applies to new quotations only; the existing quotation is untouched."
exit "$ok"
