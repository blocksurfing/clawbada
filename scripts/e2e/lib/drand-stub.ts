/**
 * Offline drand. Per real battle the API asks `/info` for the chain's genesis and period, works
 * out the round its reveal timestamp pins (D-01: the first round at or after revealedAt + 6 s)
 * and fetches that round; the engine probes `/public/latest` at boot. Every round is served at
 * once with a fixed randomness, so the run is deterministic and a warped anvil clock is fine.
 * `--live-drand` uses the real network instead — there the chain clock must not be ahead of
 * real time when the teams are revealed, or the pinned round has not been emitted yet.
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
