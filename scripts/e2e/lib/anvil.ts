/**
 * Local Anvil chain for the end-to-end run. Chain id 84532 so every viem client in the
 * monorepo (hard-wired to `baseSepolia`) talks to it without code changes.
 */
import { spawn, type Subprocess } from 'bun';

export interface AnvilHandle {
  port: number;
  rpcUrl: string;
  proc: Subprocess;
  rpc<T = unknown>(method: string, params?: unknown[]): Promise<T>;
  /** Move the chain clock forward and mine one block so `block.timestamp` reflects it. */
  increaseTime(seconds: number): Promise<void>;
  mine(): Promise<void>;
  latestTimestamp(): Promise<bigint>;
  stop(): Promise<void>;
}

export async function startAnvil(port: number, logPath: string): Promise<AnvilHandle> {
  const logFile = Bun.file(logPath).writer();
  const proc = spawn(['anvil', '--chain-id', '84532', '--port', String(port), '--silent'], {
    stdout: 'pipe', stderr: 'pipe',
  });
  void pipeTo(proc.stdout as ReadableStream<Uint8Array>, logFile);
  void pipeTo(proc.stderr as ReadableStream<Uint8Array>, logFile);
  const rpcUrl = `http://127.0.0.1:${port}`;

  const rpc = async <T,>(method: string, params: unknown[] = []): Promise<T> => {
    const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  };

  // Readiness: chain id answers.
  const t0 = Date.now();
  for (;;) {
    try {
      const id = await rpc<string>('eth_chainId');
      if (parseInt(id, 16) === 84532) break;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > 20_000) throw new Error('anvil did not start within 20 s');
    await Bun.sleep(200);
  }

  const handle: AnvilHandle = {
    port, rpcUrl, proc, rpc,
    async increaseTime(seconds) { await rpc('evm_increaseTime', [seconds]); await rpc('evm_mine', []); },
    async mine() { await rpc('evm_mine', []); },
    async latestTimestamp() {
      const block = await rpc<{ timestamp: string }>('eth_getBlockByNumber', ['latest', false]);
      return BigInt(block.timestamp);
    },
    async stop() { proc.kill(); await proc.exited; logFile.end(); },
  };
  return handle;
}

async function pipeTo(stream: ReadableStream<Uint8Array>, writer: ReturnType<ReturnType<typeof Bun.file>['writer']>) {
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    writer.write(value);
    writer.flush();
  }
}

/** Anvil's deterministic dev accounts (mnemonic "test test … junk"). */
export const ANVIL_ACCOUNTS = [
  { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' },
  { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' },
  { address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' },
  { address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' },
  { address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' },
] as const;
