/**
 * Offline drand: the API pulls ONE beacon per real battle (`/public/latest`) and the
 * engine probes connectivity at boot. A fixed round + randomness keeps the run
 * deterministic; `--live-drand` bypasses this and uses https://api.drand.sh.
 */
export const STUB_ROUND = 1000;
export const STUB_RANDOMNESS = '8e2ec2b2a4c4a0c3f5d9e6b7a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0';

export interface DrandStub { url: string; stop(): void }

export function startDrandStub(port: number): DrandStub {
  const body = (round: number) => JSON.stringify({ round, randomness: STUB_RANDOMNESS, signature: '', previous_signature: '' });
  const server = Bun.serve({
    port,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/public/latest') return new Response(body(STUB_ROUND), { headers: { 'content-type': 'application/json' } });
      const m = path.match(/^\/public\/(\d+)$/);
      if (m) return new Response(body(Number(m[1])), { headers: { 'content-type': 'application/json' } });
      if (path === '/info') return new Response(JSON.stringify({ period: 3, genesis_time: 0 }), { headers: { 'content-type': 'application/json' } });
      return new Response('not found', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${port}`, stop: () => server.stop(true) };
}
