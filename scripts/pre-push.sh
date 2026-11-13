#!/usr/bin/env bash
# Pre-push gate. On 2026-11-12 this repository's history was replaced: the same files, new commits. A clone made
# before that day still holds the previous history, and one branch built on it would bring all of it back here.
# Such a branch descends from the previous history's first commit. A fresh clone does not have that commit, so
# there this check ends at once.
# Stopped by it? Clone the repository fresh and carry your work over as files (docs/runbooks/repo-hygiene.md).
# Skip with `git push --no-verify` only when you are sure what the branch is built on.
set -euo pipefail

replaced_root="${PRE_PUSH_REPLACED_ROOT:-7fe113eee24b26443226e36fb6678d4debc2eb94}"   # the tests set their own
git cat-file -e "${replaced_root}^{commit}" 2>/dev/null || exit 0

# git feeds one line per ref being pushed: <local ref> <local id> <remote ref> <remote id>
while read -r local_ref local_id _; do
  [[ "$local_id" =~ ^0+$ ]] && continue      # deleting a remote ref sends nothing
  if git merge-base --is-ancestor "$replaced_root" "$local_id" 2>/dev/null; then
    echo "pre-push: REFUSED — $local_ref is built on the history this repository replaced on 2026-11-12." >&2
    echo "pre-push: clone the repository fresh and carry your work over as files (docs/runbooks/repo-hygiene.md)." >&2
    exit 1
  fi
done
