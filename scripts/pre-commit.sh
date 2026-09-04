#!/usr/bin/env bash
# Pre-commit gate (launch-blocker #19). Fast checks scoped to what is staged:
#   - contracts/**      -> forge build, regenerate ABIs, stage them (keeps A12's CI gate green)
#   - apps/* packages/* -> typecheck only the workspaces with staged .ts/.tsx files
# Skip with `git commit --no-verify` when you know what you are doing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.bun/bin:$HOME/.foundry/bin:$PATH"

staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0

# 1. Solidity: compile + keep the checked-in ABIs in sync with the contracts.
if grep -qE '^contracts/[^/]+\.sol$|^contracts/libraries/' <<<"$staged"; then
  echo "pre-commit: contracts changed -> forge build + extract-abis"
  forge build --quiet
  bun run extract-abis >/dev/null
  git add packages/chain/src/abis
fi

# 2. TypeScript: typecheck each workspace that has staged .ts/.tsx files.
workspaces=$(grep -E '^(apps|packages)/[^/]+/.*\.(ts|tsx)$' <<<"$staged" | cut -d/ -f1-2 | sort -u || true)
for ws in $workspaces; do
  name=$(bun -e "console.log(require('./$ws/package.json').name)")
  if bun -e "process.exit(require('./$ws/package.json').scripts?.typecheck ? 0 : 1)"; then
    echo "pre-commit: typecheck $name"
    bun run --filter "$name" typecheck >/dev/null || { echo "pre-commit: typecheck failed in $ws"; exit 1; }
  fi
done
