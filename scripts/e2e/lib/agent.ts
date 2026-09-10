/**
 * PlayerAgent — a scripted Clawbada player that does everything a real client does through
 * the public API: signed auth, calldata steps executed with its own key, queue / deposit /
 * commit / reveal, and the live V3 battle over WebSocket. Reused as the seed of the Phase 3
 * reference bot; the harness gives each agent its own X-Forwarded-For so per-IP rate limits
 * apply per wallet (the API runs with TRUST_PROXY=true for the run).
 */
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Hex } from 'viem';
import { teamCommitHash } from '@clawbada/chain';
import { v3 } from '@clawbada/game-logic';
import { FaucetAbi, TeamManagerAbi, MiningPoolAbi, type Chain } from './chain';
import { waitFor, sleep } from './wait';

export interface CalldataStep { description: string; calldata: { to: string; data: string; value?: string; chainId?: number }; optional?: boolean }

export interface AgentOpts { key: string; api: string; ws: string; chain: Chain; forwardedFor: string; label: string; log?: (s: string) => void }

export class PlayerAgent {
  readonly account;
  readonly address: string;
  private authCache: { ts: number; sig: string } | null = null;
  constructor(readonly o: AgentOpts) {
    this.account = privateKeyToAccount(o.key as Hex);
    this.address = this.account.address;
  }
  private say(s: string) { (this.o.log ?? console.log)(`[${this.o.label}] ${s}`); }

  // ── auth ──
  async authParams(): Promise<{ address: string; signature: string; timestamp: string }> {
    const now = Math.floor(Date.now() / 1000);
    if (!this.authCache || now - this.authCache.ts > 240) {
      const sig = await this.account.signMessage({ message: `Clawbada Auth: ${now}` });
      this.authCache = { ts: now, sig };
    }
    return { address: this.address, signature: this.authCache.sig, timestamp: String(this.authCache.ts) };
  }
  async headers(): Promise<Record<string, string>> {
    const a = await this.authParams();
    return { 'content-type': 'application/json', 'X-Wallet-Address': a.address, 'X-Signature': a.signature, 'X-Timestamp': a.timestamp, 'X-Forwarded-For': this.o.forwardedFor };
  }
  async get(path: string): Promise<any> {
    const res = await fetch(`${this.o.api}${path}`, { headers: await this.headers() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  }
  async post(path: string, body: unknown = {}): Promise<any> {
    const res = await fetch(`${this.o.api}${path}`, { method: 'POST', headers: await this.headers(), body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  }

  // ── calldata steps (approve + action), signed by this wallet ──
  async executeSteps(steps: CalldataStep[]) {
    const receipts = [];
    for (const step of steps) {
      receipts.push(await this.o.chain.sendStep(this.o.key, step.calldata));
    }
    return receipts;
  }

  // ── onboarding ──
  async claimFaucet(): Promise<{ lobsterIds: bigint[] }> {
    const status = await this.get(`/api/faucet/status/${this.address}`);
    if (!status.canClaimLobsters) throw new Error(`faucet: cannot claim lobsters: ${JSON.stringify(status)}`);
    const r1 = await this.post('/api/faucet/claim-lobsters');
    const [rcpt] = await this.executeSteps(r1.steps);
    const claimed = this.o.chain.events<{ tokenIds: readonly bigint[] }>(rcpt, FaucetAbi, 'LobstersClaimed')[0];
    const lobsterIds = [...claimed.tokenIds].map(BigInt);
    await sleep(1200); // faucet route rate limit is per wallet now (XFF), but be gentle
    const r2 = await this.post('/api/faucet/claim-claw');
    await this.executeSteps(r2.steps);
    this.say(`faucet: 5 lobsters ${lobsterIds.join(',')} + 7,000 CLAW`);
    return { lobsterIds };
  }

  async evolve(lobsterId: bigint, fuel1: bigint, fuel2: bigint) {
    const r = await this.post('/api/game/evolution/evolve', { lobsterId: lobsterId.toString(), fuelId1: fuel1.toString(), fuelId2: fuel2.toString() });
    await this.executeSteps(r.steps);
    this.say(`evolved #${lobsterId} (fuel #${fuel1}, #${fuel2}; approve ${r.preview?.clawCostWei ?? '?'} wei)`);
  }

  async createTeam(lobsterIds: bigint[]): Promise<bigint> {
    const r = await this.post('/api/game/teams/create', { lobsterIds: lobsterIds.map(String) });
    const [rcpt] = await this.executeSteps(r.steps);
    const ev = this.o.chain.events<{ teamId: bigint }>(rcpt, TeamManagerAbi, 'TeamCreated')[0];
    this.say(`team #${ev.teamId} = [${lobsterIds.join(',')}]`);
    return BigInt(ev.teamId);
  }

  // ── queue → battle ──
  async joinQueue(teamId: bigint, stake: string): Promise<{ status: 'queued' | 'matched'; battleId?: string }> {
    const r = await this.post('/api/game/combat/queue', { teamId: teamId.toString(), stakeAmount: stake });
    this.say(`queue: ${r.status}${r.battleId ? ` battle #${r.battleId}` : ''}`);
    return { status: r.status, battleId: r.battleId ? String(r.battleId) : undefined };
  }
  async waitMatched(timeoutMs = 60_000): Promise<string> {
    return waitFor(async () => {
      const s = await this.get('/api/game/combat/queue/status');
      return s.recentBattle?.battleId ? String(s.recentBattle.battleId) : null;
    }, { timeoutMs, everyMs: 1000, label: `${this.o.label} matched` });
  }
  battle(battleId: string) { return this.get(`/api/game/combat/${battleId}`); }

  async deposit(battleId: string) {
    const r = await this.post(`/api/game/combat/${battleId}/deposit`);
    await this.executeSteps(r.steps);
    this.say(`deposited for battle #${battleId}`);
  }

  async commit(battleId: string): Promise<{ teamId: bigint; salt: Hex }> {
    const mine = await this.get(`/api/game/combat/${battleId}/my-team`);
    const teamId = BigInt(mine.myTeamId);
    const salt = keccak256(toHex(`${battleId}:${this.address}:${Date.now()}:${Math.random()}`)) as Hex;
    const commitHash = teamCommitHash(BigInt(battleId), this.address as Hex, teamId, salt);
    const r = await this.post(`/api/game/combat/${battleId}/commit-team`, { commitHash });
    await this.executeSteps(r.steps);
    this.say(`committed team #${teamId} for battle #${battleId}`);
    return { teamId, salt };
  }

  async reveal(battleId: string, teamId: bigint, salt: Hex): Promise<string> {
    const r = await this.post(`/api/game/combat/${battleId}/reveal-team`, { teamId: teamId.toString(), salt });
    this.say(`reveal salt posted → ${r.status}`);
    return r.status;
  }

  // ── live battle over WS (ported from apps/api/scripts/play-practice.ts) ──
  async playBattle(battleId: string, opts: { policy?: v3.BotName; timeoutMs?: number } = {}): Promise<{ winner: string; reason: string; finalStateHash: string; turnLogHash: string; turns: number }> {
    const policy = v3.botPolicy(opts.policy ?? 'balanced');
    const me = this.address.toLowerCase();
    let local: v3.AtbBattleState | null = null;
    let turns = 0;
    let ws: WebSocket | null = null;
    let closedByUs = false;

    const act = async (turn: number, lobsterId: string) => {
      if (!local) return;
      let actor = local.lobsters.find((l) => l.id === lobsterId);
      let cmd = actor ? policy(local, actor) : null;
      const ok = () => { try { if (actor && cmd) { v3.validateTurn(local!, cmd); return true; } } catch { /* resync */ } return false; };
      if (!ok()) {
        const s = await this.get(`/api/game/combat/${battleId}/state`);
        local = v3.fromWire({ ...s.state, vrfSeed: '0' });
        actor = local.lobsters.find((l) => l.id === lobsterId);
        cmd = actor ? policy(local, actor) : null;
      }
      if (!cmd) { this.say(`no command for ${lobsterId}`); return; }
      ws?.send(JSON.stringify({ type: 'submit_turn', battleId, turn, command: cmd }));
    };

    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => { closedByUs = true; ws?.close(); reject(new Error(`battle #${battleId} did not finish within ${opts.timeoutMs ?? 300_000} ms`)); }, opts.timeoutMs ?? 300_000);
      const connect = async () => {
        const a = await this.authParams();
        const url = `${this.o.ws}?address=${a.address}&signature=${a.signature}&timestamp=${a.timestamp}&battleId=${battleId}`;
        ws = new WebSocket(url, { headers: { 'X-Forwarded-For': this.o.forwardedFor } } as any);
        ws.onmessage = async (m) => {
          const msg = JSON.parse(String(m.data));
          const d = msg.data;
          switch (msg.event) {
            case 'battle_snapshot':
              local = v3.fromWire({ ...d.state, vrfSeed: '0' });
              if (d.current?.controller?.toLowerCase() === me) await act(d.current.turn, d.current.lobsterId);
              break;
            case 'turn_started':
              if (d.controller?.toLowerCase() === me) await act(d.turn, d.lobsterId);
              break;
            case 'turn_resolved':
              turns++;
              if (d.state) local = v3.fromWire({ ...d.state, vrfSeed: '0' });
              break;
            case 'battle_ended':
              clearTimeout(timer); closedByUs = true; ws?.close();
              resolve({ winner: d.winner, reason: d.reason, finalStateHash: d.finalStateHash, turnLogHash: d.turnLogHash, turns });
              break;
            case 'error':
              this.say(`ws error: ${JSON.stringify(d)}`);
              break;
            default: break;
          }
        };
        ws.onclose = (e) => {
          if (closedByUs) return;
          // Auth expiry (1008) or a drop: reconnect with a fresh signature; the server replays a snapshot.
          this.say(`ws closed ${e.code} — reconnecting`);
          this.authCache = null;
          setTimeout(() => { connect().catch(reject); }, 500);
        };
        ws.onerror = () => { /* onclose follows */ };
      };
      connect().catch(reject);
    });
  }

  // ── mining ──
  async startExpedition(teamId: bigint, mineTier = 1): Promise<{ expeditionId: bigint; reward: bigint }> {
    const r = await this.post('/api/game/mining/start', { teamId: teamId.toString(), mineTier });
    const [rcpt] = await this.executeSteps(r.steps);
    const ev = this.o.chain.events<{ expeditionId: bigint; reward: bigint }>(rcpt, MiningPoolAbi, 'ExpeditionStarted')[0];
    this.say(`expedition #${ev.expeditionId} started (reward ${ev.reward})`);
    return { expeditionId: BigInt(ev.expeditionId), reward: BigInt(ev.reward) };
  }
  async claimExpedition(expeditionId: bigint) {
    const r = await this.post(`/api/game/mining/${expeditionId}/claim`);
    await this.executeSteps(r.steps);
    this.say(`expedition #${expeditionId} claimed`);
  }
}
