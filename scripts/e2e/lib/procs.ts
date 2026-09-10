/**
 * Child services (api / engine / indexer) as bun processes with an assembled env.
 * Logs are teed to `.runs/<ts>/<name>.log`; readiness is a log substring or an HTTP probe.
 */
import { spawn, type Subprocess } from 'bun';
import { join } from 'node:path';

export interface ServiceHandle {
  name: string;
  proc: Subprocess;
  logPath: string;
  /** Lines seen so far (bounded). */
  lines: string[];
  exited: boolean;
  stop(): Promise<void>;
}

export interface SpawnOpts {
  name: string;
  cwd: string;
  cmd: string[];
  env: Record<string, string>;
  runDir: string;
  verbose?: boolean;
}

const MAX_LINES = 5000;

export async function spawnService(opts: SpawnOpts): Promise<ServiceHandle> {
  const logPath = join(opts.runDir, `${opts.name}.log`);
  const writer = Bun.file(logPath).writer();
  const proc = spawn(opts.cmd, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdout: 'pipe', stderr: 'pipe' });
  const handle: ServiceHandle = {
    name: opts.name, proc, logPath, lines: [], exited: false,
    async stop() {
      if (handle.exited) return;
      proc.kill('SIGTERM');
      const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 8_000);
      await proc.exited;
      clearTimeout(t);
      writer.end();
    },
  };
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = dec.decode(value);
      writer.write(text); writer.flush();
      buf += text;
      const parts = buf.split('\n'); buf = parts.pop() ?? '';
      for (const line of parts) {
        handle.lines.push(line);
        if (handle.lines.length > MAX_LINES) handle.lines.shift();
        if (opts.verbose) console.log(`[${opts.name}] ${line}`);
      }
    }
  };
  void pump(proc.stdout as ReadableStream<Uint8Array>);
  void pump(proc.stderr as ReadableStream<Uint8Array>);
  void proc.exited.then(() => { handle.exited = true; });
  return handle;
}

export async function waitForLog(h: ServiceHandle, needle: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (h.lines.some((l) => l.includes(needle))) return;
    if (h.exited) throw new Error(`${h.name} exited before it was ready (see ${h.logPath})`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`${h.name} not ready within ${timeoutMs} ms (waiting for "${needle}", see ${h.logPath})`);
    await Bun.sleep(250);
  }
}

export async function waitForHttp(h: ServiceHandle, url: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    if (h.exited) throw new Error(`${h.name} exited before it was ready (see ${h.logPath})`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`${h.name} not ready within ${timeoutMs} ms (probe ${url}, see ${h.logPath})`);
    await Bun.sleep(250);
  }
}

/** Last N lines with a substring, for diagnostics. */
export function grepLog(h: ServiceHandle, needle: string | RegExp, n = 5): string[] {
  const re = typeof needle === 'string' ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : needle;
  return h.lines.filter((l) => re.test(l)).slice(-n);
}
