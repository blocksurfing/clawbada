import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'pre-push.sh');
const ZERO = '0'.repeat(40);
// No user or system git config: a signing key or a global hook must not decide these tests.
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(['git', '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, env });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

function commit(cwd: string, file: string): string {
  writeFileSync(join(cwd, file), file);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', file);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Runs the hook in `cwd` with the lines git would feed it. */
function push(cwd: string, replacedRoot: string, lines: string[]) {
  const p = Bun.spawnSync(['bash', script], {
    cwd,
    env: { ...env, PRE_PUSH_REPLACED_ROOT: replacedRoot },
    stdin: Buffer.from(lines.map((l) => l + '\n').join('')),
  });
  return { code: p.exitCode, err: p.stderr.toString() };
}

const line = (ref: string, id: string) => `refs/heads/${ref} ${id} refs/heads/${ref} ${ZERO}`;

let old: string; // a clone from before the replacement: holds both histories
let fresh: string; // a fresh clone: only the new history
let replacedRoot: string;
let onOld: string;
let onNew: string;
let merged: string;
let freshTip: string;

beforeAll(() => {
  old = mkdtempSync(join(tmpdir(), 'pre-push-old-'));
  git(old, 'init', '-q', '-b', 'main');
  replacedRoot = commit(old, 'a');
  onOld = commit(old, 'b');
  git(old, 'checkout', '-q', '--orphan', 'new');
  git(old, 'rm', '-rfq', '.');
  onNew = commit(old, 'c');
  git(old, 'merge', '-q', '--allow-unrelated-histories', '-m', 'both', 'main');
  merged = git(old, 'rev-parse', 'HEAD');

  fresh = mkdtempSync(join(tmpdir(), 'pre-push-fresh-'));
  git(fresh, 'init', '-q', '-b', 'main');
  freshTip = commit(fresh, 'c');
});

afterAll(() => {
  rmSync(old, { recursive: true, force: true });
  rmSync(fresh, { recursive: true, force: true });
});

describe('pre-push.sh', () => {
  test('refuses a branch built on the replaced history', () => {
    const r = push(old, replacedRoot, [line('feature', onOld)]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('REFUSED');
    expect(r.err).toContain('refs/heads/feature');
  });

  test('refuses the replaced history’s first commit itself', () => {
    expect(push(old, replacedRoot, [line('feature', replacedRoot)]).code).toBe(1);
  });

  test('refuses a merge that joins the new history with the replaced one', () => {
    expect(push(old, replacedRoot, [line('new', merged)]).code).toBe(1);
  });

  test('refuses when any one of several refs is built on it', () => {
    expect(push(old, replacedRoot, [line('ok', onNew), line('feature', onOld)]).code).toBe(1);
  });

  test('lets a branch on the new history through, even in a clone that holds both', () => {
    expect(push(old, replacedRoot, [line('ok', onNew)])).toEqual({ code: 0, err: '' });
  });

  test('deleting a remote branch is not a push of anything', () => {
    expect(push(old, replacedRoot, [`(delete) ${ZERO} refs/heads/feature ${onOld}`]).code).toBe(0);
  });

  test('a fresh clone does not have the commit: everything passes', () => {
    expect(push(fresh, replacedRoot, [line('main', freshTip)])).toEqual({ code: 0, err: '' });
  });

  test('nothing to push, nothing to refuse', () => {
    expect(push(old, replacedRoot, []).code).toBe(0);
  });
});
