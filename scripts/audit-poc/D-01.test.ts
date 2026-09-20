/**
 * AUDIT PoC — D-01: the "secret" battle VRF seed is the raw, already-public drand beacon.
 *
 * Everything here runs the REAL code paths:
 *   - apps/api BattleSessionManager.startReal (via pollOnce) picks the seed,
 *   - packages/chain DrandBeaconClient is the drand client on BOTH sides (server and attacker),
 *   - packages/game-logic v3 resolves turns, builds the client snapshot, and supplies the bots.
 * The only fake is the HTTP transport: a deterministic stand-in for the PUBLIC drand chain that
 * the server and the attacker both read. The attacker never touches server memory: it only gets the
 * JSON snapshot a player receives (GET /:battleId/state / battle_snapshot) and its own drand client.
 *
 * Run from the repo root:  ~/.bun/bin/bun test scripts/audit-poc/D-01.test.ts
 */
import { describe, test, expect } from 'bun:test';
import { v3, deriveRandom, randomBool, critChance, EvolutionTier, LobsterClass, encodeDNA, LegendStatus } from '../../packages/game-logic/src/index';
import { DrandBeaconClient } from '../../packages/chain/src/drand';
import { FakeClock, ShotClock } from '../../apps/api/src/lib/battle-session/clock';
import { BattleSessionManager } from '../../apps/api/src/lib/battle-session/manager';
import type { NewSessionRow, PendingRealBattle, SessionRow, SessionStore, SettleJobPayload } from '../../apps/api/src/lib/battle-session/store';

const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // honest player (side A)
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // attacker (side B)

// ───────────────────────── the PUBLIC drand chain (shared by everyone) ─────────────────────────
function publicDrand() {
  let latest = 5_000_123;
  const randomnessOf = (round: number) => deriveRandom(BigInt(round), 'public-drand-chain').toString(16).padStart(64, '0');
  const fetchImpl = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    const round = path === '/public/latest' ? latest : Number(path.match(/^\/public\/(\d+)$/)?.[1] ?? NaN);
    if (!Number.isFinite(round) || round > latest) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({ round, randomness: randomnessOf(round), signature: '' }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, tick: (n: number) => { latest += n; } };
}

// ───────────────────────── server fixtures (same shape as apps/api manager.test.ts) ─────────────────────────
function dnaFor(cls: LobsterClass): bigint {
  const a: number[] = [];
  for (let s = 0; s < 6; s++) a.push((cls << 4) | 1, (1 << 4) | 1, (2 << 4) | 2);
  return encodeDNA(cls, LegendStatus.Normal, 0, a as any);
}
class FakeStore {
  rows = new Map<string, SessionRow>();
  jobs: SettleJobPayload[] = [];
  pending: PendingRealBattle[] = [];
  async insertSession(row: NewSessionRow) { if (this.rows.has(row.id)) return false; this.rows.set(row.id, { ...row, createdAt: new Date(), updatedAt: new Date() } as unknown as SessionRow); return true; }
  async initSession(id: string, patch: Partial<SessionRow>) { Object.assign(this.rows.get(id)!, patch); }
  async writeTurns(id: string, _t: unknown[], snap: object) { Object.assign(this.rows.get(id)!, snap); }
  async markFinished(id: string, patch: Partial<SessionRow>) { Object.assign(this.rows.get(id)!, patch); }
  async markStatus(id: string, status: SessionRow['status']) { this.rows.get(id)!.status = status; }
  async deleteSession(id: string) { this.rows.delete(id); }
  async enqueueSettle(p: SettleJobPayload) { this.jobs.push(p); }
  async loadActive() { return []; }
  async get(id: string) { return this.rows.get(id) ?? null; }
  async listTurns() { return []; }
  async activePracticeFor() { return null; }
  async pendingRealBattles() { return this.pending.filter((p) => !this.rows.has(p.battleId.toString())); }
}
const TEAMS: Record<string, { owner: string; lobsterIds: bigint[] }> = { '11': { owner: ALICE, lobsterIds: [1n, 2n, 3n] }, '22': { owner: BOB, lobsterIds: [4n, 5n, 6n] } };
const COMP = [LobsterClass.Reaver, LobsterClass.Mantis, LobsterClass.Ember]; // same classes on both sides
const chain = {
  readTeam: async (id: bigint) => TEAMS[id.toString()],
  readLobster: async (tokenId: bigint) => ({ tokenId, owner: tokenId <= 3n ? ALICE : BOB, dna: dnaFor(COMP[Number((tokenId - 1n) % 3n)]), evolutionTier: 1, purity: 3 }),
  readBattlePhase: async () => 4,
};

// ───────────────────────── attacker toolkit (public inputs only) ─────────────────────────
/** Step 3 of the attack: recover the seed from the player snapshot + the public beacon chain. */
async function recoverSeed(snapshot: any, drand: DrandBeaconClient, lookback = 20): Promise<{ seed: bigint; round: number } | null> {
  const low32 = String(snapshot.state.layout.layoutId).split('_').pop()!;
  const { round: tip } = await drand.fetchLatest();
  for (let r = tip; r > tip - lookback; r--) {
    const seed = drand.toBigInt((await drand.fetchRound(r)).randomness);
    if ((seed & 0xffffffffn).toString(16) !== low32) continue; // 32-bit filter from layoutId
    const exact = snapshot.state.lobsters.every((l: any) => deriveRandom(seed, `tie_${l.id}`).toString() === l.tiebreak); // 256-bit confirmation
    if (exact) return { seed, round: r };
  }
  return null;
}

/** deepPolicy's position evaluation (packages/game-logic/src/v3/styles.ts `evaluate`, not exported) — copied verbatim. */
function evaluate(state: v3.AtbBattleState, team: 'A' | 'B'): number {
  let v = 0;
  for (const l of state.lobsters) {
    const sign = l.team === team ? 1 : -1;
    const hp = l.hp > l.maxHp ? l.maxHp : l.hp;
    v += sign * (Number(hp) + (l.alive ? 200 + l.charge * 25 : 0));
    for (const s of l.statuses) {
      if (s.type === 'stun') v -= sign * 120;
      if (s.type === 'bleed') v -= sign * Number(s.value) * Math.min(s.turns, 3);
      if (s.type === 'haunt') v -= sign * 60;
    }
  }
  if (state.finished && state.winner) v += state.winner === team ? 5000 : state.winner === 'draw' ? 0 : -5000;
  return v;
}
/**
 * One search, two information sets. `search(depth, beam, masked)` is the shipped `deepPolicy` beam search
 * (styles.ts) generalised to `depth` plies: rank own turns with the stock heuristic, roll each candidate
 * forward with the stock `balanced` bot standing in for whoever acts next, score with `evaluate`.
 *   masked = true  → the lookahead uses a masked seed, exactly like the shipped bots
 *                    ("so the search cannot peek at real rolls", styles.ts:113-118). This is the HONEST player.
 *   masked = false → the lookahead uses the real (recovered) seed. This is the EXPLOITER.
 * Same code, same depth, same beam, same opponent model: any edge is purely the value of knowing the seed.
 */
function search(depth: number, beam: number, masked: boolean): v3.Policy {
  return (state, actor) => {
    const ranked = v3.rankTurns(state, actor, v3.BOT_WEIGHTS.balanced).slice(0, beam);
    if (ranked.length === 1) return ranked[0].cmd;
    let best: { cmd: v3.TurnCommand; value: number } | null = null;
    for (const cand of ranked) {
      const s1 = v3.cloneBattleState(state);
      if (masked) s1.vrfSeed = deriveRandom(state.vrfSeed, `lookahead_${state.turn}`);
      v3.applyTurn(s1, cand.cmd);
      for (let d = 1; d < depth && !s1.finished; d++) {
        const next = v3.nextActor(s1)!;
        v3.applyTurn(s1, v3.hasStatus(next, 'stun') ? null : v3.chooseTurn(s1, next, v3.BOT_WEIGHTS.balanced));
      }
      const value = evaluate(s1, actor.team) + cand.score * 0.05;
      if (!best || value > best.value) best = { cmd: cand.cmd, value };
    }
    return best!.cmd;
  };
}
const DEPTH = 8, BEAM = 8;
const honest = search(DEPTH, BEAM, true);
const seer = search(DEPTH, BEAM, false);
const dmg = (events: any[]) => events.map((d) => ({ targetId: d.targetId, amount: String(d.amount), source: d.source, isCrit: !!d.isCrit, killed: !!d.killed }));
const json = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

describe('D-01: battle randomness is the raw public drand beacon', () => {
  test('a player recovers the stripped vrfSeed from the client snapshot and foresees every roll of a live real battle', async () => {
    const pub = publicDrand();
    const store = new FakeStore();
    store.pending.push({ battleId: 777n, playerA: ALICE, playerB: BOB, teamA: 11n, teamB: 22n });
    const fake = new FakeClock();
    const mgr = new BattleSessionManager({
      store: store as unknown as SessionStore,
      emit: () => undefined,
      chain,
      drand: new DrandBeaconClient('https://api.drand.sh', pub.fetchImpl), // the production client class
      log: { info: () => undefined, warn: () => undefined, error: (o) => { throw (o as any).err ?? new Error('manager error'); } },
      clock: new ShotClock(fake),
    });
    expect(await mgr.pollOnce()).toBe(1); // real startReal(): fetchLatest → vrfSeed
    const session = mgr.get('777')!;
    pub.tick(3); // the attacker looks a few drand rounds later

    // What BOB legitimately receives. The server "hides" the seed…
    const snap = json(session.snapshot());
    expect('vrfSeed' in snap.state).toBe(false);
    expect(JSON.stringify(snap)).not.toContain(session.state.vrfSeed.toString());

    // …but BOB rebuilds it from public data with his own drand client.
    const rec = await recoverSeed(snap, new DrandBeaconClient('https://api.drand.sh', pub.fetchImpl));
    expect(rec).not.toBeNull();
    expect(rec!.seed).toBe(session.state.vrfSeed); // server secret == attacker's reconstruction
    expect(rec!.round).toBe(store.rows.get('777')!.vrfRound as number); // the round the server kept DB-only

    // Foresight, turn by turn, against the live server session. BOB's local state comes ONLY from
    // the latest client snapshot + the recovered seed.
    let bobTurns = 0, foreseenCrits = 0, foreseenNonCrits = 0, aliceCritsForeseen = 0;
    for (let guard = 0; guard < 400 && !session.state.finished; guard++) {
      const view = json(session.snapshot());
      const local = v3.fromWire({ ...view.state, vrfSeed: rec!.seed.toString() });
      const cur = session.current();
      const actor = local.lobsters.find((l) => l.id === cur.lobsterId)!;
      // The roll schedule of THIS turn is known before anyone commits (it ignores the command):
      const ts = deriveRandom(rec!.seed, `turn_${cur.turn}`);
      const willCrit = randomBool(ts, 'crit', critChance(v3.effectiveStats(actor).critical), 10_000n);
      if (cur.controller === 'bot' || v3.hasStatus(actor, 'stun')) { fake.advance(100); continue; }

      if (cur.side === 'A') {
        // Honest ALICE plays the same search with the seed masked, as the shipped bots do.
        const srvActor = session.state.lobsters.find((l) => l.id === cur.lobsterId)!;
        const r = mgr.submit('777', ALICE, cur.turn, honest(session.state, srvActor));
        if (!r.ok) throw new Error(r.message);
        const hit = r.result.damage.find((d: any) => d.source === 'attack');
        if (hit) { expect(!!(hit as any).isCrit).toBe(willCrit); if (willCrit) aliceCritsForeseen++; } // BOB knew ALICE's crit before she moved
        continue;
      }
      // BOB: choose with the real rolls, PREDICT the exact outcome, then submit.
      const cmd = seer(local, actor);
      const predicted = v3.applyTurn(v3.cloneBattleState(local), cmd);
      const r = mgr.submit('777', BOB, cur.turn, cmd);
      if (!r.ok) throw new Error(r.message);
      expect(dmg(r.result.damage)).toEqual(dmg(predicted.damage)); // exact damage numbers, crit flags, counters
      expect(r.result.isEnhanced).toBe(predicted.isEnhanced);
      expect(json(r.result.statuses)).toEqual(json(predicted.statuses));
      if (cmd.action === 'attack') (willCrit ? foreseenCrits++ : foreseenNonCrits++);
      bobTurns++;
    }
    expect(session.state.finished).toBe(true);
    expect(bobTurns).toBeGreaterThan(5);

    // Post-battle repair damage was also knowable from turn 0 (keccak(seed,'repair')).
    await session.flushed();
    await new Promise((r) => setTimeout(r, 0));
    const job = store.jobs[0];
    const mine = v3.repairDamage({ ...v3.fromWire({ ...json(session.snapshot()).state, vrfSeed: rec!.seed.toString() }) });
    expect(job.damageA).toEqual(mine.damageA);
    expect(job.damageB).toEqual(mine.damageB);
    // The settle payload's hashes replay cleanly — nothing for a dispute to catch.
    expect(job.finalStateHash).toBe(v3.hashState(session.state));
    console.log(`[D-01] live battle: seed recovered from round ${rec!.round}; BOB predicted ${bobTurns}/${bobTurns} of his turns exactly ` +
      `(attacks on known-crit turns: ${foreseenCrits}, on known-non-crit turns: ${foreseenNonCrits}; ALICE crits foreseen: ${aliceCritsForeseen}); winner=${session.state.winner}`);
  });

  test('knowing the seed converts into stake: identical search, identical mirrored teams, only the seed mask removed', () => {
    const SEEDS = Number(process.env.D01_SEEDS ?? 100);
    const comps: LobsterClass[][] = [
      [LobsterClass.Reaver, LobsterClass.Mantis, LobsterClass.Ember],
      [LobsterClass.Bulwark, LobsterClass.Abyss, LobsterClass.Tempest],
      [LobsterClass.Kraken, LobsterClass.Leviathan, LobsterClass.Specter],
      [LobsterClass.Sentinel, LobsterClass.Reaver, LobsterClass.Ember],
      [LobsterClass.Mantis, LobsterClass.Tempest, LobsterClass.Abyss],
    ];
    const team = (side: string, c: LobsterClass[]) => c.map((cls, i) => ({ id: `${side}${i}`, class: cls, tier: EvolutionTier.Evolved, purity: 3, legend: false }));
    let seerWins = 0, seerLosses = 0, draws = 0, games = 0;
    for (let i = 0; i < SEEDS; i++) {
      const seed = deriveRandom(BigInt(i), 'd01-winrate'); // stand-in for beacon randomness
      const c = comps[i % comps.length];
      // Mirror match (same 3 classes, tier, purity on both sides) played twice with the exploiter on
      // each side, so team, spawn-side and seed luck all cancel: the fair baseline is exactly 50%.
      for (const seerSide of ['A', 'B'] as const) {
        const st = v3.createBattle({ battleId: 'x', vrfSeed: seed, tier: 'evolved', teamA: team('A', c), teamB: team('B', c) });
        v3.runBattle(st, { A: seerSide === 'A' ? seer : honest, B: seerSide === 'B' ? seer : honest });
        games++;
        if (st.winner === seerSide) seerWins++; else if (st.winner === 'draw' || st.winner === null) draws++; else seerLosses++;
      }
    }
    const rate = seerWins / (seerWins + seerLosses);
    // Low bracket per battle: win +2,000, lose -2,500 (CLAUDE.md stake table), before repairs.
    const evSeer = (seerWins * 2000 - seerLosses * 2500) / games;
    const evHonest = (seerLosses * 2000 - seerWins * 2500) / games;
    const z = (seerWins - (seerWins + seerLosses) / 2) / Math.sqrt((seerWins + seerLosses) / 4);
    console.log(`[D-01] win-rate: exploiter ${seerWins}W / ${seerLosses}L / ${draws}D over ${games} mirror games = ${(rate * 100).toFixed(1)}% (z=${z.toFixed(1)} vs 50%); ` +
      `Low-bracket EV per battle: exploiter ${evSeer.toFixed(0)} CLAW, honest opponent ${evHonest.toFixed(0)} CLAW (fair game: -250 each)`);
    expect(z).toBeGreaterThan(3); // not noise
    expect(rate).toBeGreaterThan(0.6); // clears the documented ~58% breakeven from a 50% baseline
    expect(evSeer).toBeGreaterThan(0); // the staked zero-sum game is now +EV for the exploiter...
    expect(evHonest).toBeLessThan(-500); // ...and the honest side loses more than twice the fee-only -250
  }, 900_000);
});
