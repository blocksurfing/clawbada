#!/bin/zsh
# Log-based metrics for the API (Battle Friends PR 4, 2026-10-29). The API has no metrics endpoint; it writes structured
# log lines (pino → Cloud Logging, the message in jsonPayload.msg), and Cloud Logging counts the ones listed here. Free at
# our volume (log-based metrics are billed only past the free monitoring allotment).
#
#   clawbada_friend_rooms_created     friend_room_created
#   clawbada_friend_rooms_joined      friend_room_joined
#   clawbada_friend_battles_started   friend_battle_started        (label: rematch true|false)
#   clawbada_friend_rematches         friend_rematch_offered
#   clawbada_battles_finished         battle_session_finished      (label: kind real|practice|friend)
#   clawbada_ws_refused               ws_origin_refused | ws_flood_closed | ws_closed_auth_expired   (label: reason)
#   clawbada_rate_limited             rate_limited                 (label: scope)
#
#   scripts/gcp-observability.sh            dry run: prints the configs it would apply
#   scripts/gcp-observability.sh --apply    create or update every metric (idempotent)
#
# Read them: Cloud Console → Monitoring → Metrics Explorer → "logging/user/clawbada_…". docs/runbooks/cloud-run.md.
set -e
PROJECT="${GCP_PROJECT:-clawbada-prod}"
SERVICE="${CLOUD_RUN_SERVICE:-clawbada-api}"
MODE="${1:---dry-run}"
[[ "$MODE" == --dry-run || "$MODE" == --apply ]] || { echo "usage: $0 [--dry-run|--apply]" >&2; exit 2; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BASE="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\""

# metric <name> <description> <msg filter> [<label> <extractor field>]
metric() {
  local name="$1" desc="$2" msgs="$3" label="$4" field="$5"
  local f="$TMP/$name.yaml"
  {
    echo "description: \"$desc\""
    echo "filter: '$BASE AND ($msgs)'"
    echo "metricDescriptor:"
    echo "  metricKind: DELTA"
    echo "  valueType: INT64"
    if [[ -n "$label" ]]; then
      echo "  labels:"
      echo "  - key: $label"
      echo "    valueType: STRING"
      echo "labelExtractors:"
      echo "  $label: EXTRACT($field)"
    fi
  } > "$f"
  echo "── $name"; sed 's/^/   /' "$f"
  [[ "$MODE" == --apply ]] || return 0
  if gcloud --project "$PROJECT" logging metrics describe "$name" >/dev/null 2>&1; then
    gcloud --project "$PROJECT" --quiet logging metrics update "$name" --config-from-file="$f"
  else
    gcloud --project "$PROJECT" --quiet logging metrics create "$name" --config-from-file="$f"
  fi
}

metric clawbada_friend_rooms_created   "Friend rooms opened (invite links made)"  'jsonPayload.msg="friend_room_created"'
metric clawbada_friend_rooms_joined    "Friends who opened an invite and joined"  'jsonPayload.msg="friend_room_joined"'
metric clawbada_friend_battles_started "Friend battles started"                   'jsonPayload.msg="friend_battle_started"' rematch jsonPayload.rematch
metric clawbada_friend_rematches       "Rematches asked for"                      'jsonPayload.msg="friend_rematch_offered"'
metric clawbada_battles_finished       "Battles finished, by kind"                'jsonPayload.msg="battle_session_finished"' kind jsonPayload.kind
metric clawbada_ws_refused             "WebSocket upgrades refused or closed by a guard" \
  'jsonPayload.msg="ws_origin_refused" OR jsonPayload.msg="ws_flood_closed" OR jsonPayload.msg="ws_closed_auth_expired"' reason jsonPayload.msg
metric clawbada_rate_limited           "Callers who hit an API rate limit (one per burst)" 'jsonPayload.msg="rate_limited"' scope jsonPayload.scope
echo "gcp-observability: done ($MODE)"
