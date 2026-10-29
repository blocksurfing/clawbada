#!/bin/zsh
# Cloud Armor in front of the API (Battle Friends PR 4, owner 2026-10-29: "yes", ~$9–10/month at today's traffic).
#
# One security policy on the load balancer's backend (clawbada-api-bs), four per-IP rules — all GENEROUS next to the
# app's own limits (apps/api/src/index.ts), so a real player never meets them; they stop floods at Google's edge before
# a single request reaches the one Cloud Run instance:
#
#   1000  /api/auth/guest                              over 60/min → 429; over 120/min → banned 10 min
#   1100  /api/game/friend/rooms* + /combat/practice   over 300/min → 429
#   1200  /ws  (socket upgrades)                       over 120/min → 429
#   1300  any /api/*                                   over 1,200/min → 429; over 3,000/min → banned 10 min
#   (default rule: allow)
#
#   scripts/gcp-armor.sh              dry run: prints what it would do (and the current state) — changes nothing
#   scripts/gcp-armor.sh --preview    create/update the policy with every rule in PREVIEW (logged, never enforced)
#   scripts/gcp-armor.sh --enforce    the same rules, enforced — run after a day of clean preview logs
#   scripts/gcp-armor.sh --remove     detach the policy from the backend and delete it (rollback)
#
# Idempotent: re-running updates the rules in place. Watch it: docs/runbooks/cloud-run.md → Cloud Armor.
set -e
PROJECT="${GCP_PROJECT:-clawbada-prod}"
BACKEND="${ARMOR_BACKEND:-clawbada-api-bs}"
POLICY="${ARMOR_POLICY:-clawbada-api-armor}"
MODE="${1:---dry-run}"
case "$MODE" in --dry-run|--preview|--enforce|--remove) ;; *) echo "usage: $0 [--dry-run|--preview|--enforce|--remove]" >&2; exit 2 ;; esac

run() {
  echo "+ $*"
  [[ "$MODE" == --dry-run ]] || "$@"
}
g() { gcloud --project "$PROJECT" --quiet "$@"; }

echo "gcp-armor: $MODE — project $PROJECT, backend $BACKEND, policy $POLICY"
current=$(g compute backend-services describe "$BACKEND" --global --format='value(securityPolicy)' 2>/dev/null || true)
echo "gcp-armor: backend's current policy: ${current:-none}"

if [[ "$MODE" == --remove ]]; then
  run g compute backend-services update "$BACKEND" --global --security-policy=''
  run g compute security-policies delete "$POLICY"
  echo "gcp-armor: removed"; exit 0
fi

if g compute security-policies describe "$POLICY" >/dev/null 2>&1; then
  echo "gcp-armor: policy exists — rules are updated in place"
else
  run g compute security-policies create "$POLICY" --type=CLOUD_ARMOR --description="Clawbada API: per-IP flood limits (scripts/gcp-armor.sh)"
fi

PREVIEW=(); [[ "$MODE" == --preview || "$MODE" == --dry-run ]] && PREVIEW=(--preview) || PREVIEW=(--no-preview)

# rule <priority> <description> <CEL expression> <action args…>
rule() {
  local prio="$1" desc="$2" expr="$3"; shift 3
  local verb=create
  g compute security-policies rules describe "$prio" --security-policy="$POLICY" >/dev/null 2>&1 && verb=update
  run g compute security-policies rules "$verb" "$prio" --security-policy="$POLICY" --description="$desc" \
    --expression="$expr" --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP "${PREVIEW[@]}" "$@"
}

rule 1000 "guest sessions: 60/min, ban 10 min over 120/min" "request.path == '/api/auth/guest'" \
  --action=rate-based-ban --rate-limit-threshold-count=60 --rate-limit-threshold-interval-sec=60 \
  --ban-threshold-count=120 --ban-threshold-interval-sec=60 --ban-duration-sec=600
rule 1100 "friend rooms + practice starts: 300/min" \
  "request.path.startsWith('/api/game/friend/rooms') || request.path == '/api/game/combat/practice'" \
  --action=throttle --rate-limit-threshold-count=300 --rate-limit-threshold-interval-sec=60
rule 1200 "socket upgrades: 120/min" "request.path == '/ws'" \
  --action=throttle --rate-limit-threshold-count=120 --rate-limit-threshold-interval-sec=60
rule 1300 "all API: 1200/min, ban 10 min over 3000/min" "request.path.startsWith('/api/')" \
  --action=rate-based-ban --rate-limit-threshold-count=1200 --rate-limit-threshold-interval-sec=60 \
  --ban-threshold-count=3000 --ban-threshold-interval-sec=60 --ban-duration-sec=600

if [[ "$current" != *"/$POLICY" ]]; then
  run g compute backend-services update "$BACKEND" --global --security-policy="$POLICY"
fi
echo "gcp-armor: done ($MODE). Blocks show in the load balancer's request logs as enforcedSecurityPolicy (preview: previewSecurityPolicy)."
