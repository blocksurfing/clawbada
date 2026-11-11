#!/usr/bin/env bash
# Pre-commit gate (launch-blocker #19). Fast checks scoped to what is staged:
#   - everything        -> no personal identity in what is committed (scripts/identity-guard.ts)
#   - contracts/**      -> forge build, regenerate ABIs, stage them (keeps A12's CI gate green)
#   - apps/* packages/* -> typecheck only the workspaces with staged .ts/.tsx files
# Skip with `git commit --no-verify` when you know what you are doing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.bun/bin:$HOME/.foundry/bin:$PATH"

staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0

# 0. Personal identity stays out of the public repo: home-directory paths, and whatever this machine's owner
#    listed in `git config clawbada.blockedIdentity` (author, committer, added lines, file names).
if command -v bun >/dev/null 2>&1; then
  bun scripts/identity-guard.ts --staged
else
  echo "pre-commit: bun not found — identity check skipped"
fi

# 1. The Foundry libraries are git submodules (mode 160000). A worktree that replaced them with
#    symlinks for a local build must never commit that: PR #179 did, and main's contracts could not
#    build until #183 restored them. Refuse any staged lib/ entry that is not a submodule.
bad=$(git ls-files -s -- lib/ | awk '$1 != "160000" {print $4}' || true)
if [ -n "$bad" ]; then
  echo "pre-commit: lib/ entries must stay submodules (mode 160000); staged as something else:"
  echo "$bad" | sed 's/^/  /'
  echo "pre-commit: restore them with: git rm --cached <path>; git update-index --add --cacheinfo 160000,<sha>,<path>"
  exit 1
fi

# 2. Solidity: compile + keep the checked-in ABIs in sync with the contracts.
if grep -qE '^contracts/[^/]+\.sol$|^contracts/libraries/' <<<"$staged"; then
  echo "pre-commit: contracts changed -> forge build + extract-abis"
  forge build --quiet
  bun run extract-abis >/dev/null
  git add packages/chain/src/abis
fi

# 3. TypeScript: typecheck each workspace that has staged .ts/.tsx files.
#    A folder name is data, never code: it reaches bun through the environment, and only a plain name is a
#    workspace at all (a staged path can come from anyone's branch).
workspaces=$(grep -E '^(apps|packages)/[^/]+/.*\.(ts|tsx)$' <<<"$staged" | cut -d/ -f1-2 | sort -u || true)
while IFS= read -r ws; do
  [ -z "$ws" ] && continue
  if ! [[ "$ws" =~ ^(apps|packages)/[A-Za-z0-9._-]+$ ]] || [ ! -f "$ws/package.json" ]; then
    echo "pre-commit: skipping typecheck for an unexpected workspace path: $(printf '%q' "$ws")"
    continue
  fi
  name=$(WS="$ws" bun -e "console.log(require(require('path').resolve(process.env.WS, 'package.json')).name)")
  if WS="$ws" bun -e "process.exit(require(require('path').resolve(process.env.WS, 'package.json')).scripts?.typecheck ? 0 : 1)"; then
    echo "pre-commit: typecheck $name"
    bun run --filter "$name" typecheck >/dev/null || { echo "pre-commit: typecheck failed in $ws"; exit 1; }
  fi
done <<<"$workspaces"
