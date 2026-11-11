/**
 * Keeps personal identity out of the public repo.
 *
 *   bun scripts/identity-guard.ts --tree     # every tracked file (CI)
 *   bun scripts/identity-guard.ts --staged   # what the commit being made adds (scripts/pre-commit.sh)
 *
 * Two checks:
 *
 * 1. Home-directory paths. A path under a user's home folder names the person behind the machine — the login is
 *    usually their own name. Write the path relative to the repo, or as ~/… . The dashed form some tools derive
 *    from a home path counts too. Placeholder logins (you, user, runner, …) are fine. Both modes.
 *
 * 2. Words the owner of this machine listed privately (--staged only). They live in the clone's git config, never in
 *    the repo — a tracked list of names to block would publish them:
 *
 *      git config --add clawbada.blockedIdentity '<regex, matched case-insensitively>'
 *
 *    The commit's author and committer, the lines it adds and the names of the files it touches must match none.
 */

/** Logins that name nobody. */
const PLACEHOLDER_LOGINS = new Set([
  'you', 'me', 'name', 'user', 'username', 'someone', 'somebody', 'example', 'shared',
  'runner', 'bun', 'node', 'root', 'ubuntu', 'app',
]);

// macOS, Linux and Windows home folders, then the dashed form. A slash form glued to a word or a host name
// (example.com/home/pricing) is a URL path, not a home folder.
const HOME_PATH = /(?<![A-Za-z0-9_.])(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)([A-Za-z0-9._-]+)|-Users-([A-Za-z0-9._]+)-/g;

/** Every home-directory path in `text` whose login is not a placeholder, as written. */
export function homePaths(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(HOME_PATH)) {
    const login = (m[1] ?? m[2]).replace(/[.-]+$/, '');
    if (login.length === 0 || PLACEHOLDER_LOGINS.has(login.toLowerCase())) continue;
    found.push(m[0]);
  }
  return found;
}

/** The private patterns `text` matches (case-insensitive). A pattern that is not a valid regex is matched literally. */
export function blockedMatches(text: string, patterns: readonly string[]): string[] {
  return patterns.filter((p) => {
    try {
      return new RegExp(p, 'i').test(text);
    } catch {
      return text.toLowerCase().includes(p.toLowerCase());
    }
  });
}

export interface AddedLine { file: string; text: string }

/** The lines a unified diff adds, with the file each belongs to. */
export function addedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^"?b\//, '').replace(/"$/, '');
    } else if (line.startsWith('+')) {
      out.push({ file, text: line.slice(1) });
    }
  }
  return out;
}

function git(...args: string[]): string {
  const r = Bun.spawnSync(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0 ? r.stdout.toString() : '';
}

function checkTree(): string[] {
  // git narrows the files; homePaths() decides. -a: a PDF or an image can carry a path in its metadata.
  const raw = git('grep', '-n', '-z', '-a', '-E', '(/Users/|/home/|\\\\Users\\\\|-Users-)', '--', '.');
  const problems: string[] = [];
  for (const row of raw.split('\n')) {
    const [file, line, ...rest] = row.split('\0');
    if (!file || !line) continue;
    for (const hit of homePaths(rest.join('\0'))) problems.push(`${file}:${line}: ${hit}`);
  }
  return problems;
}

function checkStaged(): string[] {
  const problems: string[] = [];
  const names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean);
  const added = addedLines(git('diff', '--cached', '--no-color', '--text', '-U0', '--diff-filter=ACMR'));

  for (const name of names) for (const hit of homePaths(name)) problems.push(`${name} (file name): ${hit}`);
  for (const { file, text } of added) for (const hit of homePaths(text)) problems.push(`${file}: ${hit}`);

  const patterns = git('config', '--get-all', 'clawbada.blockedIdentity').split('\n').map((s) => s.trim()).filter(Boolean);
  if (patterns.length > 0) {
    const who = `${git('var', 'GIT_AUTHOR_IDENT')} ${git('var', 'GIT_COMMITTER_IDENT')}`;
    if (blockedMatches(who, patterns).length > 0) {
      problems.push(
        'the author or committer of this commit matches a blocked personal identifier — ' +
          "set the project identity: git config user.name 'clawbada-dev' && git config user.email 'support@clawbada.com'",
      );
    }
    for (const name of names) {
      if (blockedMatches(name, patterns).length > 0) problems.push(`${name} (file name): matches a blocked personal identifier`);
    }
    const files = new Set<string>();
    for (const { file, text } of added) {
      if (!files.has(file) && blockedMatches(text, patterns).length > 0) files.add(file);
    }
    for (const file of files) problems.push(`${file}: an added line matches a blocked personal identifier`);
  }
  return problems;
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== '--tree' && mode !== '--staged') {
    console.error('usage: bun scripts/identity-guard.ts --tree | --staged');
    process.exit(2);
  }
  const problems = mode === '--tree' ? checkTree() : checkStaged();
  if (problems.length > 0) {
    console.error('identity-guard: personal identity must not reach the public repo:');
    for (const p of problems.slice(0, 30)) console.error(`  ${p.length > 200 ? `${p.slice(0, 200)}…` : p}`);
    if (problems.length > 30) console.error(`  … and ${problems.length - 30} more`);
    console.error('identity-guard: write paths relative to the repo (or as ~/…); see the top of scripts/identity-guard.ts');
    process.exit(1);
  }
}
