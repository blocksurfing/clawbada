#!/bin/zsh
# Production deploy for the web app — use this, not a bare `npx vercel deploy --prod`.
#
#   scripts/deploy-web.sh                 # refuses a folder with uncommitted changes
#   scripts/deploy-web.sh --allow-dirty   # deploys them anyway, and lists them
# Any other argument goes to `vercel deploy`.
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
# The CLI uploads this folder as it stands, not a commit: an uncommitted edit or a stray new file would go live
# without ever having been reviewed. Refuse unless the folder matches its HEAD commit. Ignored files do not count
# (the Unity build, node_modules, .vercel).
ALLOW_DIRTY=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--allow-dirty" ]; then ALLOW_DIRTY=1; else ARGS+=("$arg"); fi
done
if ! DIRTY="$(git -C "$ROOT" status --porcelain 2>&1)"; then DIRTY="git status failed: $DIRTY"; fi
if [ -n "$DIRTY" ]; then
  if [ "$ALLOW_DIRTY" = 1 ]; then
    echo "deploy-web: --allow-dirty — deploying WITH these changes that are not in a commit:" >&2
    sed 's/^/  /' <<<"$DIRTY" >&2
  else
    echo "REFUSING to deploy — this folder has changes that are not in a commit, and they would go live:" >&2
    sed 's/^/  /' <<<"$DIRTY" >&2
    echo "Commit or remove them, or run with --allow-dirty to deploy them anyway." >&2
    exit 1
  fi
fi
HEAD_LINE="$(git -C "$ROOT" log -1 --format='%h %s' 2>/dev/null || true)"
if [ -n "$HEAD_LINE" ]; then echo "deploy-web: deploying $HEAD_LINE" >&2; fi
cd "$ROOT"
# Pinned so a deploy never doubles as a CLI upgrade. Bump deliberately.
VERCEL_CLI_VERSION="${VERCEL_CLI_VERSION:-59.19.0}"
# An array, not a string: this is zsh, which does not word-split an unquoted "$VERCEL" —
# the string form looked for a command literally named "npx vercel@59.19.0" (#83 shipped that).
VERCEL=(npx "vercel@${VERCEL_CLI_VERSION}")

# The first CLI call after a while answers `"Not authorized"` and the very next one succeeds
# (seen on 59.16, 59.18 and twice on the pinned 59.19 — so not the version). It behaves like
# a stale auth token that the failed call refreshes. Warm the session with a cheap call first,
# and if the deploy still says Not authorized, run it once more before giving up.
"${VERCEL[@]}" whoami >/dev/null 2>&1 || true
for attempt in 1 2; do
  out="$("${VERCEL[@]}" deploy --prod --yes "${ARGS[@]}" 2>&1 | tee /dev/stderr)" || true
  if ! grep -q '"Not authorized"' <<<"$out"; then
    grep -q '"readyState": "READY"' <<<"$out" && exit 0
    exit 1
  fi
  [ "$attempt" = 1 ] && echo "deploy-web: Not authorized on the first call — retrying once" >&2
done
exit 1
