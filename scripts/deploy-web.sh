#!/bin/zsh
# Production deploy for the web app — use this, not a bare `npx vercel deploy --prod`.
#
# BuildScript.BuildWebGL writes apps/web/public/unity-build/PLACEHOLDER_AUDIO.txt when it is
# run with -allowPlaceholderAudio (a local audition build carrying uncommitted audio), and deletes
# it on a clean build. The bundle is opaque once built, so this marker is the only tell.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="$ROOT/apps/web/public/unity-build/PLACEHOLDER_AUDIO.txt"
if [ -f "$MARKER" ]; then
  echo "REFUSING to deploy — the local WebGL build contains uncommitted placeholder audio:" >&2
  sed 's/^/  /' "$MARKER" >&2
  echo "Rebuild the player WITHOUT -allowPlaceholderAudio, then run this again." >&2
  exit 1
fi
cd "$ROOT"
# Pinned so a deploy never doubles as a CLI upgrade. Bump deliberately.
VERCEL_CLI_VERSION="${VERCEL_CLI_VERSION:-59.19.0}"
VERCEL="npx vercel@${VERCEL_CLI_VERSION}"

# The first CLI call after a while answers `"Not authorized"` and the very next one succeeds
# (seen on 59.16, 59.18 and twice on the pinned 59.19 — so not the version). It behaves like
# a stale auth token that the failed call refreshes. Warm the session with a cheap call first,
# and if the deploy still says Not authorized, run it once more before giving up.
$VERCEL whoami >/dev/null 2>&1 || true
for attempt in 1 2; do
  out="$($VERCEL deploy --prod --yes "$@" 2>&1 | tee /dev/stderr)" || true
  if ! grep -q '"Not authorized"' <<<"$out"; then
    grep -q '"readyState": "READY"' <<<"$out" && exit 0
    exit 1
  fi
  [ "$attempt" = 1 ] && echo "deploy-web: Not authorized on the first call — retrying once" >&2
done
exit 1
