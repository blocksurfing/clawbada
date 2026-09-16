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
# Pinned: a bare `npx vercel` pulls whatever is newest, and the first run of a freshly
# installed CLI has failed "Not authorized" three deploys running (59.16, 59.18, 59.19) —
# the retry then succeeds. Bump deliberately, not as a side effect of deploying.
VERCEL_CLI_VERSION="${VERCEL_CLI_VERSION:-59.19.0}"
exec npx "vercel@${VERCEL_CLI_VERSION}" deploy --prod --yes "$@"
