/**
 * PlayerAgent — a scripted Clawbada player that does everything a real client does through
 * the public API: signed auth, calldata steps executed with its own key, queue / deposit /
 * commit / reveal, and the live V3 battle over WebSocket. Reused as the seed of the Phase 3
 * reference bot; the harness gives each agent its own X-Forwarded-For so per-IP rate limits
 * apply per wallet (the API runs with TRUST_PROXY=true for the run).
 */
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Hex } from 'viem';
import { teamCommitHash, buildAuthMessage, newAuthNonce } from '@clawbada/chain';
import { v3 } from '@clawbada/game-logic';
import { FaucetAbi, TeamManagerAbi, MiningPoolAbi, type Chain } from './chain';
import { waitFor, sleep } from './wait';

export interface CalldataStep { description: string; calldata: { to: string; data: string; value?: string; chainId?: number }; optional?: boolean }

export interface AgentOpts { key: string; api: string; ws: string; chain: Chain; forwardedFor: string; label: string; log?: (s: string) => void }

export class PlayerAgent {
  readonly account;
  readonly address: string;
  private authCache: { ts: number; sig: string; nonce: string } | null = null;
  constructor(readonly o: AgentOpts) {
    this.account = privateKeyToAccount(o.key as Hex);
    this.address = this.account.address;
  }
  private say(s: string) { (this.o.log ?? console.log)(`[${this.o.label}] ${s}`); }

  // ── auth ──
  /** C-01: the EIP-4361 login message, bound to a domain and the API's chain. An agent has no
   *  page origin, so it signs for the API's default domain (the first one /api/auth/params lists). */
  private authConfig: { domain: string; chainId: number } | null = null;
  async authParams(): Promise<{ address: string; signature: string; timestamp: string; nonce: string; domain: string }> {
    if (!this.authConfig) {
      const p = await (await fetch(`${this.o.api}/api/auth/params`)).json() as { domains: string[]; chainId: number };
      this.authConfig = { domain: p.domains[0], chainId: p.chainId };
    }
    const now = Math.floor(Date.now() / 1000);
    if (!this.authCache || now - this.authCache.ts > 240) {
      const nonce = newAuthNonce();
      const message = buildAuthMessage({ domain: this.authConfig.domain, address: this.address, chainId: this.authConfig.chainId, nonce, issuedAt: now });
      this.authCache = { ts: now, sig: await this.account.signMessage({ message }), nonce };
    }
    return { address: this.address, signature: this.authCache.sig, timestamp: String(this.authCache.ts), nonce: this.authCache.nonce, domain: this.authConfig.domain };
  }
  async headers(): Promise<Record<string, string>> {
    const a = await this.authParams();
    return { 'content-type': 'application/json', 'X-Wallet-Address': a.address, 'X-Signature': a.signature, 'X-Timestamp': a.timestamp, 'X-Nonce': a.nonce, 'X-Auth-Domain': a.domain, 'X-Forwarded-For': this.o.forwardedFor };
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
  /** `tick` runs on every poll while waiting for the lobsters — the harness mines a block with it
   *  (Anvil only mines when a transaction arrives; a real chain needs nothing). */
  async claimFaucet(opts: { tick?: () => Promise<void> } = {}): Promise<{ lobsterIds: bigint[] }> {
    const status = await this.get(`/api/faucet/status/${this.address}`);
    if (!status.canClaimLobsters) throw new Error(`faucet: cannot claim lobsters: ${JSON.stringify(status)}`);
    const r1 = await this.post('/api/faucet/claim-lobsters');
    await this.executeSteps(r1.steps);
    // D-10: that transaction commits the claim; the lobsters are rolled from a block that did not
    // exist yet and minted by the engine's keeper a few seconds later. Wait for them — and if the
    // keeper is down, finish the claim ourselves (finalizeClaim is permissionless).
    const lobsterIds = await this.awaitFaucetLobsters(20_000, opts.tick);
    await sleep(1200); // faucet route rate limit is per wallet now (XFF), but be gentle
    const r2 = await this.post('/api/faucet/claim-claw');
    await this.executeSteps(r2.steps);
    this.say(`faucet: 5 lobsters ${lobsterIds.join(',')} + 7,000 CLAW`);
    return { lobsterIds };
  }

  /** Poll until the claim is finalized; after `selfServeAfterMs` stop waiting for the keeper. */
  async awaitFaucetLobsters(selfServeAfterMs = 20_000, tick?: () => Promise<void>): Promise<bigint[]> {
    const started = Date.now();
    const fromBlock = await this.o.chain.pub.getBlockNumber();
    await waitFor(async () => {
      if (tick) await tick();
      const st = await this.get(`/api/faucet/status/${this.address}`);
      if (!st.lobsterClaimPending) return true;
      if (Date.now() - started > selfServeAfterMs) {
        const r = await this.post('/api/faucet/finalize-lobsters').catch(() => null); // 409 = too early
        if (r?.steps) { this.say(`faucet: keeper is slow — ${r.action} ourselves`); await this.executeSteps(r.steps); }
      }
      return null;
    }, { timeoutMs: 90_000, everyMs: 1_500, label: `${this.o.label}: faucet lobsters minted` });
    const logs = await this.o.chain.pub.getContractEvents({ address: this.o.chain.d.contracts.Faucet, abi: FaucetAbi as any, eventName: 'LobstersClaimed', args: { claimer: this.address }, fromBlock: fromBlock > 300n ? fromBlock - 300n : 0n });
    const claimed = (logs.at(-1) as any)?.args as { tokenIds: readonly bigint[] } | undefined;
    if (!claimed) throw new Error('faucet: LobstersClaimed event not found after finalize');
    return [...claimed.tokenIds].map(BigInt);
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

  /**
   * D-06: contest a proposed battle result. Any participant may, while the battle is
   * AwaitingFinalize and the chain clock has not passed payoutDeadline. Posts the bond (10% of
   * the bracket stake: refunded if the admin changes the result in any respect, slashed if it
   * stands). Limit: 5 disputes per address per 24 hours.
   */
  async dispute(battleId: string, evidence = ''): Promise<void> {
    const r = await this.post(`/api/game/combat/${battleId}/dispute`, { evidence });
    await this.executeSteps(r.steps);
    this.say(`disputed battle #${battleId} (bond ${r.preview?.bond ?? '?'} wei, ${r.preview?.secondsLeft ?? '?'} s were left)`);
  }

  /**
   * D-06: after a battle, compare what the chain was told with what you just played. The
   * server's own verdict is in `settlement` on the battle read; an agent that kept its own
   * `battle_ended` result can check the winner itself too. Returns true if it disputed.
   */
  async disputeIfRogue(battleId: string): Promise<boolean> {
    const b = await this.get(`/api/game/combat/${battleId}`);
    const st = b.settlement;
    if (!st || !st.rogue || st.disputed) return false;
    await this.dispute(battleId, `settlement check: ${st.verdict}`);
    return true;
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
  async playBattle(battleId: string, opts: { policy?: v3.BotName; timeoutMs?: number } = {}): Promise<{ winner: string; reason: string; finalStateHash: string; turnLogHash: string; turns: number; disputed: boolean }> {
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

    let disputing = false;
    let disputed = false;
    /** A dispute takes two transactions; a short battle can end before they confirm. */
    let inFlight: Promise<void> = Promise.resolve();
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => { clearInterval(guard); closedByUs = true; ws?.close(); reject(new Error(`battle #${battleId} did not finish within ${opts.timeoutMs ?? 300_000} ms`)); }, opts.timeoutMs ?? 300_000);
      // D-06: the WebSocket alert only exists while a session is live. A result submitted within a
      // second or two of the reveal lands BEFORE the server ever starts a session, so there is
      // nothing to push the alert through. Poll the battle read too: `settlement.rogue` is true
      // whenever the result on-chain is not provably the server's own.
      const guard = setInterval(() => {
        if (disputing) return;
        disputing = true;
        inFlight = this.disputeIfRogue(battleId)
          .then((did) => { if (did) disputed = true; else disputing = false; })
          .catch((err) => { disputing = false; this.say(`settlement guard: ${String(err).slice(0, 160)}`); });
      }, 5_000);
      const connect = async () => {
        const a = await this.authParams();
        const url = `${this.o.ws}?address=${a.address}&signature=${a.signature}&timestamp=${a.timestamp}&nonce=${a.nonce}&domain=${encodeURIComponent(a.domain)}&battleId=${battleId}`;
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
              clearTimeout(timer); clearInterval(guard); closedByUs = true; ws?.close();
              await inFlight; // report `disputed` truthfully even when the battle ends first
              resolve({ winner: d.winner, reason: d.reason, finalStateHash: d.finalStateHash, turnLogHash: d.turnLogHash, turns, disputed });
              break;
            case 'settlement_alert':
              // D-06: a result for this battle landed on-chain while it is still being played
              // here, so it did not come from the game server (a stolen RESOLVER key settles
              // the moment teams are revealed; the dispute window then runs out while you are
              // busy playing). An agent must not wait for the battle to end: dispute now.
              this.say(`SETTLEMENT ALERT battle #${battleId}: on-chain winner ${d.proposedWinner}, deadline ${d.payoutDeadline}`);
              if (!d.disputed && !disputing) {
                disputing = true;
                inFlight = this.dispute(battleId, `settlement_alert: ${d.reason}`)
                  .then(() => { disputed = true; })
                  .catch((err) => { disputing = false; this.say(`dispute failed: ${String(err).slice(0, 200)}`); });
              }
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
