/**
 * Watches the dependency tree for newly published advisories.
 *
 *   bun scripts/audit-check.ts            # fails when `bun audit` reports an advisory the baseline does not list
 *   bun scripts/audit-check.ts --update   # rewrite the baseline to what `bun audit` reports now — review the diff
 *
 * `bun audit` on its own cannot gate anything here: the tree already carries advisories in the wallet connectors'
 * own dependencies and in build-time tools, so it has been red for as long as anyone looked. This compares against
 * scripts/audit-baseline.json instead — what was known when the list was last reviewed — and goes red only for
 * something new. It runs from .github/workflows/audit.yml on a schedule, never as a pull-request check.
 *
 * Listed does not mean harmless: the baseline records what is known, not what was judged safe.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASELINE = resolve(import.meta.dir, 'audit-baseline.json');

interface Advisory { url?: string; title?: string; severity?: string }
export type AuditReport = Record<string, Advisory[]>;
/** package → advisory id (GHSA-…) → "severity — title" */
export type Known = Record<string, Record<string, string>>;

const advisoryId = (a: Advisory) => (a.url ?? '').split('/').pop() || a.title || 'unknown';

/** `bun audit --json` output as package → advisory id → one line, both levels sorted. */
export function summarize(report: AuditReport): Known {
  const out: Known = {};
  for (const pkg of Object.keys(report).sort()) {
    const rows: Record<string, string> = {};
    for (const a of report[pkg]) rows[advisoryId(a)] = `${a.severity ?? 'unknown'} — ${a.title ?? ''}`.trim();
    out[pkg] = Object.fromEntries(Object.keys(rows).sort().map((k) => [k, rows[k]]));
  }
  return out;
}

export interface Comparison {
  /** Reported now, not in the baseline: the reason to go red. */
  fresh: { pkg: string; id: string; line: string }[];
  /** In the baseline, no longer reported: the list can shrink. */
  gone: { pkg: string; id: string }[];
}

export function compare(current: Known, baseline: Known): Comparison {
  const fresh: Comparison['fresh'] = [];
  const gone: Comparison['gone'] = [];
  for (const [pkg, rows] of Object.entries(current)) {
    for (const [id, line] of Object.entries(rows)) if (!baseline[pkg]?.[id]) fresh.push({ pkg, id, line });
  }
  for (const [pkg, rows] of Object.entries(baseline)) {
    for (const id of Object.keys(rows)) if (!current[pkg]?.[id]) gone.push({ pkg, id });
  }
  return { fresh, gone };
}

/** Runs `bun audit --json`. The registry call can fail for a moment: a few tries before giving up. */
async function audit(): Promise<AuditReport> {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = Bun.spawnSync([process.execPath, 'audit', '--json'], { cwd: resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' });
    const text = r.stdout.toString().trim();
    try {
      // Exit code 1 only says "advisories found". No output at all with exit 0 is a clean tree.
      if (text === '' && r.exitCode === 0) return {};
      const parsed = JSON.parse(text.slice(text.indexOf('{')));
      if (parsed && typeof parsed === 'object') return parsed as AuditReport;
    } catch {
      /* fall through to the retry */
    }
    lastError = `${r.stderr.toString().trim() || text.slice(0, 200) || 'no output'} (exit ${r.exitCode})`;
    if (attempt < 3) await Bun.sleep(5000 * attempt);
  }
  throw new Error(`bun audit gave no report: ${lastError}`);
}

if (import.meta.main) {
  const current = summarize(await audit());
  const count = (k: Known) => Object.values(k).reduce((n, rows) => n + Object.keys(rows).length, 0);

  if (process.argv.includes('--update')) {
    const file = {
      about:
        'Advisories `bun audit` reported when this list was last reviewed. scripts/audit-check.ts fails on anything not ' +
        'listed here. Listed does not mean harmless. Regenerate with `bun scripts/audit-check.ts --update`, review the diff.',
      reviewed: new Date().toISOString().slice(0, 10),
      advisories: current,
    };
    writeFileSync(BASELINE, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`audit-check: baseline rewritten — ${count(current)} advisories in ${Object.keys(current).length} packages`);
    process.exit(0);
  }

  const baseline = (JSON.parse(readFileSync(BASELINE, 'utf8')) as { advisories: Known }).advisories;
  const { fresh, gone } = compare(current, baseline);
  console.log(`audit-check: ${count(current)} advisories reported, ${count(baseline)} in the baseline`);
  if (gone.length > 0) {
    console.log(`audit-check: ${gone.length} baseline entries are no longer reported (shrink the list with --update):`);
    for (const g of gone) console.log(`  ${g.pkg}  ${g.id}`);
  }
  if (fresh.length > 0) {
    console.error(`audit-check: ${fresh.length} NEW advisories — not in scripts/audit-baseline.json:`);
    for (const f of fresh) console.error(`  ${f.pkg}  ${f.line}\n      https://github.com/advisories/${f.id}`);
    console.error('audit-check: upgrade the package, or — once it is understood — record it with `bun scripts/audit-check.ts --update`.');
    process.exit(1);
  }
  console.log('audit-check: nothing new');
}
