import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';

/**
 * The guards are process-level, so they are tested on a real process: a child that abandons a rejected promise
 * and throws out of a timer callback (helpers/process-guards-child.ts).
 */
const CHILD = join(import.meta.dir, '..', 'helpers', 'process-guards-child.ts');

async function run(mode: 'guarded' | 'bare'): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn([process.execPath, CHILD, mode], { stdout: 'pipe', stderr: 'pipe' });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, out };
}

describe('process guards', () => {
  test('with the guards, both failures are logged once and the process keeps serving', async () => {
    const { code, out } = await run('guarded');
    expect(out).toContain('logged unhandled_rejection: abandoned promise');
    expect(out).toContain('logged uncaught_exception: thrown in a timer');
    expect(out).toContain('still serving');
    expect(out).not.toContain('second install must not log');
    expect(out.match(/logged unhandled_rejection/g)?.length).toBe(1);
    expect(code).toBe(0);
  });

  // The control: this is what the guards are for. Without them the runtime ends the process.
  test('without the guards, the same failures end the process', async () => {
    const { code, out } = await run('bare');
    expect(out).not.toContain('still serving');
    expect(code).not.toBe(0);
  });
});
