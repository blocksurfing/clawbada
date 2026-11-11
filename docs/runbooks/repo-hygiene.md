# Repo hygiene: what guards the repository itself

This repository is public. These are the checks that keep secrets and personal identity out of it and keep its build
tools from changing unannounced. None of them is a deploy step.

## Personal identity

`scripts/identity-guard.ts` has two jobs.

- **Home-directory paths.** A path under a user's home folder carries the login, which is usually the person's name.
  The commit hook refuses a commit that adds one, and CI (job "Repo hygiene") fails if a tracked file contains one.
  Write the path relative to the repo, or as `~/…`. Placeholder logins such as `you` or `runner` pass.
- **Your own list.** Words you never want committed — a surname, a host name — go in your clone's git config, not in
  the repo, where a list of names to block would publish them:

  ```bash
  git config --add clawbada.blockedIdentity '<regex, matched case-insensitively>'
  git config --get-all clawbada.blockedIdentity      # what is set
  ```

  The commit hook then refuses a commit whose author, committer, added lines or file names match. The list is per
  clone: each person sets their own, and CI never sees it.

The hook runs only where `bun install` has set husky up. `git commit --no-verify` skips it; CI still checks the paths.

What the guard cannot do: it sees a commit before it is made. Anything already pushed is public, and removing it
means rewriting history.

## Secrets on disk

Every `.env` and `.env.*` file is ignored by git, by the Vercel upload and by the Docker build, at any depth. Only
`.env.example` is tracked. `.claude/settings.local.json` (Claude Code's per-machine approvals) is ignored too.

## Dependencies

`.github/workflows/audit.yml` runs `scripts/audit-check.ts` every Monday and whenever `bun.lock` changes on `main`. It
is not a pull-request check. It compares `bun audit` with `scripts/audit-baseline.json` and goes red only for an
advisory the baseline does not list.

When it goes red: read the advisory it prints, upgrade the package if the code can reach the flaw, and once it is
understood record it:

```bash
bun scripts/audit-check.ts            # what is new
bun scripts/audit-check.ts --update   # rewrite the baseline, then review and commit the diff
```

The baseline records what is known, not what was judged safe.

## Build tools

- GitHub Actions are pinned to commits, with the release in a trailing comment. To update one, replace the commit
  with the one its new release tag points to (`gh api repos/<owner>/<action>/commits/<tag> --jq .sha`).
- CI and all four Dockerfiles use one Bun version (`BUN_VERSION`), the one production runs. Bump them together.
- The commit hook (`scripts/pre-commit.sh`) treats staged folder names as data and typechecks only real workspaces.
