import { describe, expect, test } from 'bun:test';
import { addedLines, blockedMatches, homePaths } from './identity-guard';

// Built at run time: a literal home path in this file would trip the very check it tests.
const mac = (login: string, rest = '') => ['', 'Users', login].join('/') + rest;
const linux = (login: string, rest = '') => ['', 'home', login].join('/') + rest;
const win = (login: string, rest = '') => ['C:', 'Users', login].join('\\') + rest;
const dashed = (login: string, rest = '') => ['', 'Users', login, rest].join('-');

describe('homePaths', () => {
  test('finds macOS, Linux and Windows home folders', () => {
    expect(homePaths(`cd ${mac('jane', '/project')} && ls`)).toEqual([mac('jane')]);
    expect(homePaths(`"${linux('jane.doe', '/x')}"`)).toEqual([linux('jane.doe')]);
    expect(homePaths(`open ${win('Jane', '\\Desktop')}`)).toEqual([win('Jane')]);
  });

  test('finds a home folder at the very end of the text', () => {
    expect(homePaths(`cd ${mac('jane')}`)).toEqual([mac('jane')]);
  });

  test('finds the dashed form tools derive from a home path', () => {
    expect(homePaths(`~/.tool/projects/${dashed('jane', 'Project')}/memory/x.md`)).toEqual([dashed('jane', '')]);
  });

  test('finds every path on a line', () => {
    expect(homePaths(`${mac('jane', '/a')} and ${mac('joe', '/b')}`)).toEqual([mac('jane'), mac('joe')]);
  });

  test('placeholder logins are not personal', () => {
    for (const login of ['you', 'runner', 'bun', 'USER', 'Shared']) {
      expect(homePaths(`${mac(login, '/x')} ${linux(login, '/x')}`)).toEqual([]);
    }
  });

  test('a URL path is not a home folder', () => {
    expect(homePaths(`https://example.com${linux('pricing', '/plans')}`)).toEqual([]);
    expect(homePaths(`fetch(base${mac('list')})`)).toEqual([]);
  });

  test('a path with a placeholder in angle brackets is documentation', () => {
    expect(homePaths('/Users/<login>/project and -Users-<login>-Project')).toEqual([]);
  });

  test('ordinary text is left alone', () => {
    expect(homePaths('Users can go home. See apps/web/src/lib/users.ts and ~/project.')).toEqual([]);
  });
});

describe('blockedMatches', () => {
  test('matches case-insensitively, as a regex', () => {
    expect(blockedMatches('Author: JANE DOE <jd@example.com>', ['jane\\s+doe', 'nobody'])).toEqual(['jane\\s+doe']);
  });

  test('an invalid regex is matched literally', () => {
    expect(blockedMatches('host janes-laptop(2)', ['Laptop(2'])).toEqual(['Laptop(2']);
    expect(blockedMatches('host janes-laptop', ['Laptop(2'])).toEqual([]);
  });

  test('no patterns, no matches', () => {
    expect(blockedMatches('anything', [])).toEqual([]);
  });
});

describe('addedLines', () => {
  test('keeps only added lines, each with its file', () => {
    const diff = [
      'diff --git a/docs/a.md b/docs/a.md',
      '--- a/docs/a.md',
      '+++ b/docs/a.md',
      '@@ -1 +1,2 @@',
      '-old',
      '+new one',
      '+new two',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- /dev/null',
      '+++ b/src/b.ts',
      '@@ -0,0 +1 @@',
      '+const x = 1;',
    ].join('\n');
    expect(addedLines(diff)).toEqual([
      { file: 'docs/a.md', text: 'new one' },
      { file: 'docs/a.md', text: 'new two' },
      { file: 'src/b.ts', text: 'const x = 1;' },
    ]);
  });
});
