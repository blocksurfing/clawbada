/**
 * Headless-Chrome driver for the battle harness (rebuilt 2026-09-11 after the original was
 * lives in the repo now). Talks raw Chrome DevTools Protocol over a WebSocket — no puppeteer.
 *
 *   bash chrome-restart.sh          # fresh profile on :9222, SwiftShader for WebGL
 *   bun cdp.ts specials.ts          # runs the script's default export with a Browser
 *
 * A harness script is `export default async function (b: Browser) { … }`.
 */
const HOST = process.env.CDP_HOST ?? '127.0.0.1:9222';

export interface Browser {
  send(method: string, params?: unknown): Promise<any>;
  goto(url: string): Promise<void>;
  eval(js: string): Promise<any>;
  clickAt(x: number, y: number): Promise<void>;
  screenshot(path: string): Promise<void>;
  /** Poll `js` until truthy. Returns false on timeout instead of throwing. */
  waitFor(js: string, timeoutMs?: number, pollMs?: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  /** Console output seen so far, newest last: "[log] …", "[error] …", "[exception] …". */
  readonly logs: string[];
  drainLogs(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pickTarget(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const list = (await (await fetch(`http://${HOST}/json/list`)).json()) as Array<{
        type: string; url: string; webSocketDebuggerUrl?: string;
      }>;
      const page = list.find((t) => t.type === 'page' && !!t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* Chrome not up yet */
    }
    await sleep(500);
  }
  throw new Error(`no debuggable page on ${HOST} — run chrome-restart.sh first`);
}

async function connect(): Promise<Browser> {
  const ws = new WebSocket(await pickTarget());
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const logs: string[] = [];
  let nextId = 1;
  let loadedAt = 0;

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.params ?? {})})`));
      else p.resolve(msg.result);
      return;
    }
    switch (msg.method) {
      case 'Runtime.consoleAPICalled': {
        const text = (msg.params.args ?? [])
          .map((a: any) => (a.value !== undefined ? String(a.value) : a.description ?? a.type))
          .join(' ');
        logs.push(`[${msg.params.type}] ${text}`);
        break;
      }
      case 'Runtime.exceptionThrown': {
        const d = msg.params.exceptionDetails;
        logs.push(`[exception] ${d?.exception?.description ?? d?.text ?? 'unknown'}`);
        break;
      }
      case 'Log.entryAdded':
        logs.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text}`);
        break;
      case 'Page.loadEventFired':
        loadedAt = Date.now();
        break;
    }
  });

  const send = (method: string, params: unknown = {}): Promise<any> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 60_000);
    });
  };

  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await send(`${domain}.enable`);

  const evaluate = async (js: string) => {
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval threw');
    return r.result?.value;
  };

  const b: Browser = {
    send,
    logs,
    drainLogs: () => { logs.length = 0; },
    sleep,
    eval: evaluate,
    async goto(url) {
      const before = loadedAt;
      await send('Page.navigate', { url });
      const t0 = Date.now();
      while (loadedAt === before && Date.now() - t0 < 60_000) await sleep(100);
      await sleep(300);
    },
    async clickAt(x, y) {
      const p = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: 1 };
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, buttons: 0 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p });
    },
    async screenshot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await Bun.write(path, Buffer.from(r.data, 'base64'));
    },
    async waitFor(js, timeoutMs = 30_000, pollMs = 250) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try {
          if (await evaluate(js)) return true;
        } catch {
          /* page mid-navigation */
        }
        await sleep(pollMs);
      }
      return false;
    },
  };
  return b;
}

const scriptPath = process.argv[2];
await Bun.write(`${import.meta.dir}/out/.keep`, '');   // screenshots and handoff files land in out/ (gitignored)
if (!scriptPath) {
  console.error('usage: bun cdp.ts <harness-script.ts>');
  process.exit(2);
}
const mod = await import(scriptPath.startsWith('/') ? scriptPath : `${import.meta.dir}/${scriptPath}`);
const run = mod.default;
if (typeof run !== 'function') {
  console.error(`${scriptPath} has no default-exported function`);
  process.exit(2);
}
const browser = await connect();
try {
  await run(browser);
} finally {
  process.exit(0);
}
