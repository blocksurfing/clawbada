import type { BattleSnapshot, TurnCommand } from './battle-protocol';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface CalldataResult {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export interface CalldataStep {
  description: string;
  calldata: CalldataResult;
  optional?: boolean;
}

export interface StepsResponse {
  steps: CalldataStep[];
  preview?: Record<string, unknown>;
}

// F5-01: team reveal is resolver-submitted — the endpoint returns a status, not calldata.
export interface TeamRevealResponse {
  status: 'waiting_for_opponent' | 'both_revealed';
  message: string;
}

type AuthHeaders = Record<string, string>;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  auth?: AuthHeaders,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...auth,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? `API error ${res.status}`);
  }

  return res.json();
}

function get<T>(path: string, auth?: AuthHeaders) {
  return request<T>('GET', path, undefined, auth);
}

function post<T>(path: string, body?: unknown, auth?: AuthHeaders) {
  return request<T>('POST', path, body, auth);
}

function del<T>(path: string, auth?: AuthHeaders) {
  return request<T>('DELETE', path, undefined, auth);
}

// ── Agent ──

interface AgentProfile {
  address: string;
  elo: number;
  wins: number;
  losses: number;
  totalBattles: number;
  totalExpeditions: number;
  totalBreeds: number;
  registered: boolean;
}

interface LobsterData {
  tokenId: string;
  owner: string;
  dna: string;
  class: number;
  className: string;
  classRole: string;
  legend: number;
  breedType: number;
  purity: number;
  evolutionTier: number;
  tierName: string;
  damage: number;
  breedCount: number;
  generation: number;
  soulbound: boolean;
  locked: boolean;
  stats: { hp: string; attack: string; armor: string; speed: string; critical: string };
  bodyParts: Array<{
    dominant: { classAffinity: number; variant: number };
    r1: { classAffinity: number; variant: number };
    r2: { classAffinity: number; variant: number };
  }>;
}

const agent = {
  register: (auth: AuthHeaders) => post<{ registered: true }>('/api/agent/register', undefined, auth),
  profile: (address: string) => get<AgentProfile>(`/api/agent/profile/${address}`),
  lobsters: (address: string) => get<{ address: string; count: number; lobsters: LobsterData[] }>(`/api/agent/lobsters/${address}`),
};

// ── Faucet ──

interface FaucetStatus {
  address: string;
  isOpen: boolean;
  isEligible: boolean;
  hasClaimedLobsters: boolean;
  hasClaimedClaw: boolean;
  canClaimLobsters: boolean;
  canClaimClaw: boolean;
  reason?: string;
}

const faucet = {
  status: (address: string) => get<FaucetStatus>(`/api/faucet/status/${address}`),
  claimLobsters: (auth: AuthHeaders) => post<StepsResponse>('/api/faucet/claim-lobsters', undefined, auth),
  claimClaw: (auth: AuthHeaders) => post<StepsResponse>('/api/faucet/claim-claw', undefined, auth),
};

// ── Teams ──

interface TeamData {
  teamId: string;
  owner: string;
  lobsterIds: string[];
  active: boolean;
  lobsters?: LobsterData[];
}

const teams = {
  list: (address: string) => get<{ address: string; count: number; teams: TeamData[] }>(`/api/game/teams?address=${address}`),
  get: (teamId: string) => get<TeamData>(`/api/game/teams/${teamId}`),
  create: (lobsterIds: [string, string, string], auth: AuthHeaders) => post<StepsResponse>('/api/game/teams/create', { lobsterIds }, auth),
  disband: (teamId: string, auth: AuthHeaders) => post<StepsResponse>(`/api/game/teams/${teamId}/disband`, undefined, auth),
};

// ── Mining ──

interface ExpeditionData {
  expeditionId: string;
  teamId: string;
  owner: string;
  season: number;
  mineTier: number;
  startTime: number;
  reward: string;
  claimed: boolean;
  completionTime: number;
  remainingSeconds: number;
}

const mining = {
  list: (address: string) => get<{ address: string; count: number; expeditions: ExpeditionData[] }>(`/api/game/mining?address=${address}`),
  get: (expeditionId: string) => get<ExpeditionData>(`/api/game/mining/${expeditionId}`),
  start: (teamId: string, mineTier: number, auth: AuthHeaders) => post<StepsResponse>('/api/game/mining/start', { teamId, mineTier }, auth),
  claim: (expeditionId: string, auth: AuthHeaders) => post<StepsResponse>(`/api/game/mining/${expeditionId}/claim`, undefined, auth),
};

// ── Breeding ──

interface BreedPreview {
  parentA: { tokenId: string; breedCount: number; generation: number; cost: string; breedsRemaining: number };
  parentB: { tokenId: string; breedCount: number; generation: number; cost: string; breedsRemaining: number };
  totalCost: string;
  offspringGeneration: number;
  classProbabilities: Record<string, number>;
  legendChance: string;
}

interface CooldownData {
  lobsterId: string;
  cooldownEnd: number;
  remainingSeconds: number;
  isReady: boolean;
}

const breeding = {
  preview: (parentA: string, parentB: string) => get<BreedPreview>(`/api/game/breeding/preview?parentA=${parentA}&parentB=${parentB}`),
  cooldown: (lobsterId: string) => get<CooldownData>(`/api/game/breeding/cooldowns/${lobsterId}`),
  breed: (parentA: string, parentB: string, auth: AuthHeaders) => post<StepsResponse>('/api/game/breeding/breed', { parentA, parentB }, auth),
};

// ── Evolution ──

interface EvolutionCost {
  lobsterId: string;
  currentTier: number;
  currentTierName: string;
  nextTier: number;
  nextTierName: string;
  fuelCount: number;
  fuelTier: number;
  fuelTierName: string;
  clawCost: string;
  previewStats: { hp: string; attack: string; armor: string; speed: string; critical: string };
}

const evolution = {
  cost: (lobsterId: string) => get<EvolutionCost>(`/api/game/evolution/cost/${lobsterId}`),
  evolve: (lobsterId: string, fuelId1: string, fuelId2: string, auth: AuthHeaders) =>
    post<StepsResponse>('/api/game/evolution/evolve', { lobsterId, fuelId1, fuelId2 }, auth),
};

// ── Repair ──

interface RepairCost {
  lobsterId: string;
  currentDamage: number;
  pointsToRepair: number;
  cost: string;
  fullRepairCost: string;
  ratePerPoint: string;
  tierName: string;
  battleBlocked: boolean;
  damageAfterRepair: number;
}

const repair = {
  cost: (lobsterId: string, points?: number) =>
    get<RepairCost>(`/api/game/repair/cost/${lobsterId}${points != null ? `?points=${points}` : ''}`),
  repair: (lobsterId: string, pointsToRepair: number | undefined, auth: AuthHeaders) =>
    post<StepsResponse>('/api/game/repair/repair', { lobsterId, pointsToRepair }, auth),
};

// ── Marketplace ──

interface ListingData {
  listingId: string;
  tokenId: string;
  seller: string;
  price: string;
  listedAt: number;
  active?: boolean;
  class?: number;
  evolutionTier?: number;
  purity?: number;
  legend?: boolean;
}

interface ListingsResponse {
  count: number;
  listings: ListingData[];
}

interface MarketFilters {
  class?: number;
  tier?: number;
  minPurity?: number;
  maxPrice?: number;
  minPrice?: number;
  legend?: boolean;
  sort?: 'price_asc' | 'price_desc' | 'recent';
  limit?: number;
  offset?: number;
}

const market = {
  listings: (filters: MarketFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.class != null) params.set('class', String(filters.class));
    if (filters.tier != null) params.set('tier', String(filters.tier));
    if (filters.minPurity != null) params.set('minPurity', String(filters.minPurity));
    if (filters.maxPrice != null) params.set('maxPrice', String(filters.maxPrice));
    if (filters.minPrice != null) params.set('minPrice', String(filters.minPrice));
    if (filters.legend != null) params.set('legend', String(filters.legend));
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.limit != null) params.set('limit', String(filters.limit));
    if (filters.offset != null) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return get<ListingsResponse>(`/api/game/market/listings${qs ? `?${qs}` : ''}`);
  },
  getListing: (listingId: string) => get<ListingData>(`/api/game/market/listings/${listingId}`),
  list: (tokenId: string, price: string, auth: AuthHeaders) => post<StepsResponse>('/api/game/market/list', { tokenId, price }, auth),
  buy: (listingId: string, auth: AuthHeaders) => post<StepsResponse>('/api/game/market/buy', { listingId }, auth),
  delist: (listingId: string, auth: AuthHeaders) => post<StepsResponse>(`/api/game/market/listings/${listingId}/delist`, undefined, auth),
};

// ── Combat ──

/** Half-width sentinel used by the matchmaker server: `'all'` = "any power within
 *  stake bracket". Numeric values represent ±halfWidth from the seeker's power. */
export type RadiusHalfWidth = number | 'all';

export interface PowerRadiusPayload {
  low: number;
  high: number;
  /** Present on tick-emitted events; absent on initial /queue response (which
   *  always starts at halfWidth=0). */
  halfWidth?: RadiusHalfWidth;
}

/** V3 S1 queue join response. Two flavors discriminated by `status`. */
export interface QueueResponse {
  status: 'matched' | 'queued';
  /** Always present — what bracket the player joined / matched into. */
  bracket?: number;
  /** Always present — the team's snapshotted power score (3..9). */
  power?: number;
  // — `queued` flavor —
  initialRadius?: PowerRadiusPayload;
  /** F-16-a: server's queue-row `enqueuedAt.getTime()`. Client uses this
   *  for `state.since` so the WS stale-event filter compares like-clocks. */
  enqueuedAtMs?: number;
  /** F-Y3: queue row PK (bigint stringified). Collision-proof session id.
   *  Client prefers this over `enqueuedAtMs` for stale-event filtering. */
  queueId?: string;
  // — `matched` flavor —
  battleId?: string;
  opponent?: string;
  yourPower?: number;
  opponentPower?: number;
}

/** F-15-b: response shape for DELETE /queue when the matchmaker won the
 *  cancel-vs-match race. The client must transition to `matched` instead
 *  of `cancelled` since the user is now in a battle. */
export interface LeaveQueueResponse {
  removed?: boolean;
  matched?: boolean;
  battleId?: string;
  bracket?: number;
  opponent?: string;
  yourPower?: number;
  opponentPower?: number;
}

export interface QueueStatus {
  inQueue: boolean;
  /** Present iff inQueue=true. */
  bracket?: number;
  power?: number;
  elo?: number;
  teamId?: string;
  enqueuedAt?: string;
  /** F-Y3: queue row PK as collision-proof session id for rehydration. */
  queueId?: string;
  waitingSeconds?: number;
  radius?: PowerRadiusPayload;
  /** F-X1 (PR 6): when not in queue, surfaces a recent matched battle so the
   *  client can rehydrate to `matched` state after a WS reconnect that
   *  missed the original `match_found` event. */
  recentBattle?: {
    battleId: string;
    bracket: number;
    opponent: string;
    yourPower: number;
    opponentPower: number;
    /** PR-B X1: operator-worker lifecycle. 0=pending_create (on-chain
     *  createBattle in flight), 1=created (battle live). Null for
     *  pre-PR-B rows. status=4 (create_failed) is surfaced as
     *  `failedRecentBattle` instead. */
    status: number | null;
  };
  /** Codex PR-B FU-2 (MEDIUM): explicit signal that the engine's
   *  create_battle job died (`battles.status=4`) for a recent matchmaking
   *  decision involving this address. Surfaced as a separate field so the
   *  queued reducer can transition out of `queued` without rehydrating
   *  into a non-existent battle. */
  failedRecentBattle?: {
    battleId: string;
    bracket: number;
  };
}

/** Single-bucket pool-depth response shape. */
export interface PoolDepthSingle {
  bracket: number;
  power: number;
  depth: number;
}

/** All-buckets pool-depth response shape. */
export interface PoolDepthAll {
  pools: PoolDepthSingle[];
}

interface ChainBattleData {
  battleId: string;
  playerA: string;
  playerB: string;
  teamIdA: string;
  teamIdB: string;
  stakeAmount: string;
  phase: number;
  winner: string;
  depositA: boolean;
  depositB: boolean;
  teamCommitA: string;
  teamCommitB: string;
  teamRevealedA: boolean;
  teamRevealedB: boolean;
  /** V3 settle proposal (AwaitingFinalize+): address(0) == draw. */
  proposedWinner: string;
  finalStateHash: string;
  turnLogHash: string;
  roundCommitA: string;
  roundCommitB: string;
  roundRevealedA: boolean;
  roundRevealedB: boolean;
  /** X13: Unix-seconds deadlines (stringified bigint). `phaseDeadline`
   *  applies to Deposit/TeamCommit/TeamReveal/Active; `payoutDeadline`
   *  applies to AwaitingFinalize. The frontend compares against
   *  `Date.now() / 1000` to decide whether to surface the handleTimeout
   *  button. */
  phaseDeadline: string;
  payoutDeadline: string;
  /** X13 LOW-01: H-01 dispute flag. `handleTimeout` reverts on disputed
   *  AwaitingFinalize battles (requires admin resolution), so the CTA is
   *  hidden in that state. */
  disputed: boolean;
}

interface DbBattleData {
  battleId: string;
  playerA: string;
  playerB: string;
  teamA: string;
  teamB: string;
  stakeBracket: number;
  stakeAmount: string;
  phase: number;
  /** PR-B X1: operator-worker lifecycle. 0=pending_create, 1=created,
   *  2=settled, 3=cancelled, 4=create_failed. Null for pre-PR-B rows. */
  status: number | null;
  powerA: number | null;
  powerB: number | null;
  winner: string | null;
  protocolFee: string | null;
  winnerPayout: string | null;
  totalRounds: number | null;
  createdAt: string;
  settledAt: string | null;
}

interface BattleData {
  /** PR-B X1: null while battles.status=0 (pending_create) — on-chain
   *  createBattle hasn't landed yet, so readBattle would throw NOT_FOUND.
   *  Frontend should render a pending-create UI while chain is null. */
  chain: ChainBattleData | null;
  db: DbBattleData | null;
}

export interface CreatePracticeBody {
  teamId?: string;
  lobsterIds?: string[];
  bot?: string;
  opponent?: 'mirror' | 'random';
  layoutId?: string;
  preset?: string;
}

interface BattleHistoryItem {
  battleId: string;
  /** BattlePhase numeric value: 0=None, 1=Deposit, 2=TeamCommit, 3=TeamReveal,
   *  4=Active, 5=AwaitingFinalize, 6=Settled, 7=Cancelled.
   *  In-progress battles have phase 1-5; consumers querying for "active battles
   *  to resume" should filter for that range. */
  phase: number;
  playerA: string;
  playerB: string;
  stakeBracket: number;
  stakeAmount: string;
  winner: string | null;
  // Optional UI-derived fields (some legacy callers expect these; the server
  // currently doesn't compute them — kept optional to avoid lying about types):
  opponent?: string;
  result?: 'win' | 'loss';
  payout?: string;
  bracket?: string;
  timestamp?: number;
}

const combat = {
  joinQueue: (teamId: string, stakeAmount: string, auth: AuthHeaders) =>
    post<QueueResponse>('/api/game/combat/queue', { teamId, stakeAmount }, auth),
  queueStatus: (auth: AuthHeaders) => get<QueueStatus>('/api/game/combat/queue/status', auth),
  leaveQueue: (auth: AuthHeaders) => del<LeaveQueueResponse>('/api/game/combat/queue', auth),
  /** Returns active queue counts per (stake, power) sub-pool. With both query
   *  params, returns the single bucket's depth; without them, returns all
   *  non-empty buckets. Public — no auth. */
  poolDepth: (bracket?: number, power?: number) => {
    const params = new URLSearchParams();
    if (bracket !== undefined) params.set('bracket', String(bracket));
    if (power !== undefined) params.set('power', String(power));
    const qs = params.toString();
    const url = `/api/game/combat/pool-depth${qs ? `?${qs}` : ''}`;
    return bracket !== undefined && power !== undefined
      ? get<PoolDepthSingle>(url)
      : get<PoolDepthAll>(url);
  },
  history: (address: string, limit = 20) =>
    get<{ address: string; count: number; battles: BattleHistoryItem[] }>(`/api/game/combat/history?address=${address}&limit=${limit}`),
  getBattle: (battleId: string) => get<BattleData>(`/api/game/combat/${battleId}`),
  /** A2: caller-private endpoint returning the requesting wallet's queued
   *  team ID. Returns 404 for non-participants and unknown battles. Used by
   *  the commit-reveal flow because `chain.teamIdA/B` are 0 pre-reveal. */
  getMyTeam: (battleId: string, auth: AuthHeaders) =>
    get<{ battleId: string; myTeamId: string | null }>(`/api/game/combat/${battleId}/my-team`, auth),
  /** X13: permissionless handleTimeout — surfaced when the chain phase deadline
   *  has elapsed and nobody has progressed the battle. */
  handleTimeout: (battleId: string, auth: AuthHeaders) =>
    post<StepsResponse>(`/api/game/combat/${battleId}/handle-timeout`, undefined, auth),
  // V3 live sessions
  createPractice: (body: CreatePracticeBody, auth: AuthHeaders) => post<{ battleId: string; snapshot: BattleSnapshot }>('/api/game/combat/practice', body, auth),
  submitTurn: (battleId: string, turn: number, command: TurnCommand, auth: AuthHeaders) =>
    post<{ accepted: boolean; duplicate: boolean; result: unknown }>(`/api/game/combat/${battleId}/turn`, { turn, command }, auth),
  getState: (battleId: string, auth?: AuthHeaders) => get<BattleSnapshot>(`/api/game/combat/${battleId}/state`, auth),
  getTurns: (battleId: string, auth?: AuthHeaders) => get<{ battleId: string; count: number; turns: unknown[] }>(`/api/game/combat/${battleId}/turns`, auth),
  getLegal: (battleId: string, auth: AuthHeaders) => get<{ turn: number; lobsterId: string; commands: TurnCommand[] }>(`/api/game/combat/${battleId}/legal`, auth),
  deposit: (battleId: string, auth: AuthHeaders) => post<StepsResponse>(`/api/game/combat/${battleId}/deposit`, undefined, auth),
  commitTeam: (battleId: string, commitHash: string, auth: AuthHeaders) =>
    post<StepsResponse>(`/api/game/combat/${battleId}/commit-team`, { commitHash }, auth),
  // F5-01: reveal returns a status (not calldata) — the resolver submits the atomic tx.
  revealTeam: (battleId: string, teamId: string, salt: string, auth: AuthHeaders) =>
    post<TeamRevealResponse>(`/api/game/combat/${battleId}/reveal-team`, { teamId, salt }, auth),
};

// ── Leaderboard ──

interface BattleLeaderboardEntry {
  rank: number;
  address: string;
  elo: number;
  wins: number;
  losses: number;
  totalBattles: number;
  winRate: string;
}

interface MiningLeaderboardEntry {
  rank: number;
  owner: string;
  totalExpeditions: number;
  totalReward: string;
}

interface BreedingLeaderboardEntry {
  rank: number;
  breeder: string;
  totalBreeds: number;
  totalCost: string;
}

const leaderboard = {
  battles: (limit = 50, sort: 'elo' | 'wins' = 'elo') =>
    get<{ sort: string; count: number; leaderboard: BattleLeaderboardEntry[] }>(`/api/leaderboard/battle?limit=${limit}&sort=${sort}`),
  mining: (limit = 50, season?: number) =>
    get<{ season: string; count: number; leaderboard: MiningLeaderboardEntry[] }>(
      `/api/leaderboard/mining?limit=${limit}${season != null ? `&season=${season}` : ''}`,
    ),
  breeding: (limit = 50) =>
    get<{ count: number; leaderboard: BreedingLeaderboardEntry[] }>(`/api/leaderboard/breeding?limit=${limit}`),
};

// ── Activity ──

export interface ActivityEvent {
  id: string;
  type: string;
  contract: string;
  txHash: string;
  blockNumber: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface ActivityResponse {
  events: ActivityEvent[];
  nextCursor: string | null;
}

const activity = {
  recent: (limit = 30, cursor?: string, type?: string) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    if (type) params.set('type', type);
    return get<ActivityResponse>(`/api/activity/recent?${params.toString()}`);
  },
};

// ── Exports ──

export const api = {
  agent,
  faucet,
  teams,
  mining,
  breeding,
  evolution,
  repair,
  market,
  combat,
  leaderboard,
  activity,
};

export type {
  AgentProfile,
  LobsterData,
  FaucetStatus,
  TeamData,
  ExpeditionData,
  BreedPreview,
  CooldownData,
  EvolutionCost,
  RepairCost,
  ListingData,
  ListingsResponse,
  MarketFilters,
  // QueueResponse + QueueStatus moved to inline `export interface` above.
  BattleData,
  ChainBattleData,
  DbBattleData,
  BattleHistoryItem,
  BattleLeaderboardEntry,
  MiningLeaderboardEntry,
  BreedingLeaderboardEntry,
  ActivityResponse,
};
