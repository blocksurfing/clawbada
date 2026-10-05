import {
  getPublicClient,
  getLobsterNFT,
  getTeamManager,
  getMiningPool,
  getFaucet,
  getBreedingLab,
  getMarketplace,
  getBattleArena,
  getEvolutionLab,
  getRepairShop,
  addresses,
} from '@clawbada/chain';
import {
  decodeDNA,
  getBaseStats,
  scaleStats,
  type DecodedDNA,
  type Stats,
  EvolutionTier,
  LegendStatus,
} from '@clawbada/game-logic';
import { ApiError } from './errors';
import { LAUNCH_STAKES, STAKE_BRACKET_LABELS, stakeReferenceWei } from '@clawbada/game-logic';

const isTestnet = process.env.CHAIN_ENV !== 'mainnet';

function client() {
  // Cast needed: bun resolves separate viem copies for different workspace packages,
  // causing PublicClient types to be structurally identical but nominally incompatible.
  return getPublicClient(isTestnet) as any;
}

// ──────────── Lobster ────────────

export interface ChainLobster {
  tokenId: bigint;
  owner: string;
  dna: bigint;
  decoded: DecodedDNA;
  evolutionTier: number;
  damage: number;
  breedCount: number;
  generation: number;
  soulbound: boolean;
  locked: boolean;
  purity: number;
  stats: Stats;
}

export async function readLobster(tokenId: bigint): Promise<ChainLobster> {
  const c = client();
  const nft = getLobsterNFT(c);

  try {
    const [lobsterData, owner, purity] = await Promise.all([
      nft.read.getLobster([tokenId]),
      nft.read.ownerOf([tokenId]),
      nft.read.getPurity([tokenId]),
    ]);

    // viem decodes named tuple structs as objects with named properties
    const dna = lobsterData.dna;
    const evolutionTier = lobsterData.evolutionTier;
    const damage = lobsterData.damage;
    const breedCount = lobsterData.breedCount;
    const generation = lobsterData.generation;
    const soulbound = lobsterData.soulbound;
    const locked = lobsterData.locked;

    const decoded = decodeDNA(dna);
    const baseStats = getBaseStats(decoded.class);
    const stats = scaleStats(baseStats, evolutionTier as EvolutionTier, decoded.legend === LegendStatus.Legend);

    return {
      tokenId,
      owner: owner as string,
      dna,
      decoded,
      evolutionTier,
      damage,
      breedCount,
      generation,
      soulbound,
      locked,
      purity: Number(purity),
      stats,
    };
  } catch {
    throw new ApiError('NOT_FOUND', `Lobster #${tokenId} not found`);
  }
}

export async function readLobstersByOwner(ownerAddress: string): Promise<ChainLobster[]> {
  const { db, lobsters } = await import('@clawbada/db');
  const { eq } = await import('drizzle-orm');

  const rows = await db
    .select()
    .from(lobsters)
    .where(eq(lobsters.owner, ownerAddress.toLowerCase()));

  return rows.map((row) => {
    const dna = BigInt(row.dna);
    const decoded = decodeDNA(dna);
    const baseStats = getBaseStats(decoded.class);
    const stats = scaleStats(baseStats, row.evolutionTier as EvolutionTier, decoded.legend === LegendStatus.Legend);

    return {
      tokenId: row.tokenId,
      owner: row.owner,
      dna,
      decoded,
      evolutionTier: row.evolutionTier,
      damage: row.damage,
      breedCount: row.breedCount,
      generation: row.generation,
      soulbound: row.soulbound,
      locked: row.locked,
      purity: row.purity,
      stats,
    };
  });
}

// ──────────── Teams ────────────

export interface ChainTeam {
  teamId: bigint;
  owner: string;
  lobsterIds: [bigint, bigint, bigint];
  active: boolean;
}

export async function readTeam(teamId: bigint): Promise<ChainTeam> {
  const c = client();
  const tm = getTeamManager(c);

  try {
    const data = await tm.read.getTeam([teamId]);
    return {
      teamId,
      owner: data.owner as string,
      lobsterIds: data.lobsterIds as unknown as [bigint, bigint, bigint],
      active: data.active,
    };
  } catch {
    throw new ApiError('NOT_FOUND', `Team #${teamId} not found`);
  }
}

export async function readTeamsByOwner(ownerAddress: string): Promise<ChainTeam[]> {
  const c = client();
  const tm = getTeamManager(c);

  try {
    const teamIds = await tm.read.getTeamsByOwner([ownerAddress as `0x${string}`]);
    const teams = await Promise.all((teamIds as bigint[]).map((id) => readTeam(id)));
    return teams;
  } catch {
    return [];
  }
}

// ──────────── Mining / Expeditions ────────────

export interface ChainExpedition {
  expeditionId: bigint;
  teamId: bigint;
  owner: string;
  season: bigint;
  mineTier: number;
  startTime: bigint;
  reward: bigint;
  claimed: boolean;
  isComplete: boolean;
}

/** Current chain time (latest block timestamp). Contracts gate on block.timestamp, not the
 *  server's wall clock — the two diverge on a local chain with time travel. */
export async function readChainNow(): Promise<bigint> {
  const block = await client().getBlock({ blockTag: 'latest' });
  return BigInt(block.timestamp);
}

export const WEI = 10n ** 18n;

/** $GOLD cost (wei) to evolve a lobster from `fromTier`, as EvolutionLab charges it. */
export async function readEvolutionCost(fromTier: number): Promise<bigint> {
  const lab = getEvolutionLab(client()) as any;
  return BigInt(await lab.read.EVOLUTION_COSTS([BigInt(fromTier)]));
}

/** Total $GOLD cost (wei) to breed two parents, per BreedingLab's own schedule. */
export async function readBreedCost(a: { breedCount: number; generation: number }, b: { breedCount: number; generation: number }): Promise<bigint> {
  const lab = getBreedingLab(client()) as any;
  const [costA, costB] = await Promise.all([
    lab.read.getBreedCostPerParent([a.breedCount, a.generation]),
    lab.read.getBreedCostPerParent([b.breedCount, b.generation]),
  ]);
  return BigInt(costA) + BigInt(costB);
}

/** $GOLD per damage point (wei) for a tier — bps of the live MiningPool base reward. */
export async function readRepairRate(tier: number): Promise<bigint> {
  const shop = getRepairShop(client()) as any;
  return BigInt(await shop.read.repairRate([tier]));
}

export async function readExpedition(expeditionId: bigint): Promise<ChainExpedition> {
  const c = client();
  const pool = getMiningPool(c);

  try {
    const data = await pool.read.getExpedition([expeditionId]);
    const now = await readChainNow();
    const isComplete = now >= data.startTime + BigInt(4 * 60 * 60);

    return {
      expeditionId,
      teamId: data.teamId,
      owner: data.owner as string,
      season: data.season,
      mineTier: data.mineTier,
      startTime: data.startTime,
      reward: data.reward,
      claimed: data.claimed,
      isComplete,
    };
  } catch {
    throw new ApiError('NOT_FOUND', `Expedition #${expeditionId} not found`);
  }
}

export async function readActiveExpedition(teamId: bigint): Promise<bigint> {
  const c = client();
  const pool = getMiningPool(c);
  return pool.read.getActiveExpedition([teamId]) as Promise<bigint>;
}

export interface ChainSeasonConfig {
  totalEmission: bigint;
  baseReward: bigint;
  startTime: bigint;
  totalMinted: bigint;
  /** TOK-G1 glide state (undefined only on a pre-glide mock): the season's launch reward, the index of
   *  the last hourly epoch the glide re-pegged in, and the demand estimate it paced against. */
  launchBaseReward?: bigint;
  lastRepegEpoch?: bigint;
  trailingWeightServed?: bigint;
}

export async function readSeasonConfig(season: bigint): Promise<ChainSeasonConfig> {
  const c = client();
  const pool = getMiningPool(c);

  const data = await pool.read.getSeasonConfig([season]);
  return {
    totalEmission: data.totalEmission,
    baseReward: data.baseReward,
    startTime: data.startTime,
    totalMinted: data.totalMinted,
    launchBaseReward: data.launchBaseReward,
    lastRepegEpoch: data.lastRepegEpoch,
    trailingWeightServed: data.trailingWeightServed,
  };
}

/** The battle-rank boost MiningPool would apply to this team right now (bps, 0..5,000), bound to the
 *  team's Power (the sum of its lobsters' tiers) exactly as startExpedition computes it. */
export async function readTeamBoostBps(teamId: bigint, power: number): Promise<number> {
  const pool = getMiningPool(client());
  return Number(await pool.read.teamBoostBps([teamId, power]));
}

export type StartSimulation =
  /** The chain accepts the call (`simulated: false` when the RPC could not run the dry run at all). */
  | { ok: true; simulated: boolean; note?: string }
  /** The chain would revert, with the decoded custom error. */
  | { ok: false; errorName: string; args: unknown[] };

/** L5 (review 2026-10-03): dry-run startExpedition as the caller so the API hands out only
 *  transactions the chain accepts, and names the exact revert otherwise. A transport failure is
 *  not a revert: the quote still goes out, flagged unsimulated. */
export async function simulateStartExpedition(teamId: bigint, mineTier: number, account: string): Promise<StartSimulation> {
  const pool = getMiningPool(client());
  try {
    await pool.simulate.startExpedition([teamId, mineTier], { account: account as `0x${string}` });
    return { ok: true, simulated: true };
  } catch (err) {
    const revert = decodeRevert(err);
    if (revert) return { ok: false, errorName: revert.name, args: revert.args };
    return { ok: true, simulated: false, note: `dry run unavailable: ${String((err as Error)?.message ?? err).slice(0, 160)}` };
  }
}

/** viem wraps a custom-error revert in a cause chain whose data carries `errorName` + `args`. */
function decodeRevert(err: unknown): { name: string; args: unknown[] } | null {
  let e: any = err;
  for (let depth = 0; e && depth < 8; depth++) {
    const data = e.data;
    if (data && typeof data.errorName === 'string') return { name: data.errorName, args: Array.isArray(data.args) ? data.args : [] };
    e = e.cause;
  }
  return null;
}

export async function readCurrentSeason(): Promise<bigint> {
  const c = client();
  const pool = getMiningPool(c);
  return pool.read.currentSeason() as Promise<bigint>;
}

/** The live per-expedition rate (wei). TOK-G1 glides it hourly, so the launch constant is only right in hour one. */
export async function readCurrentBaseReward(): Promise<bigint> {
  const pool = getMiningPool(client());
  return pool.read.currentBaseReward() as Promise<bigint>;
}

export interface ChainEpochBudget {
  /** This hour's spend ceiling (wei). */
  cap: bigint;
  /** Minted against it so far this hour (wei). */
  minted: bigint;
  /** Unix seconds at which the next hourly epoch opens. */
  nextEpochAt: bigint;
}

/** D-19: the hourly spend ceiling, what has been minted against it, and when the next hour opens. */
export async function readEpochBudget(): Promise<ChainEpochBudget> {
  const pool = getMiningPool(client());
  const [cap, minted, nextEpochAt] = (await pool.read.epochBudget()) as readonly [bigint, bigint, bigint];
  return { cap, minted, nextEpochAt };
}

/** Current head block number. */
export async function readBlockNumber(): Promise<bigint> {
  try {
    return (await client().getBlockNumber()) as bigint;
  } catch {
    throw new ApiError('CHAIN_ERROR', 'Could not read the block number');
  }
}

// ──────────── Faucet ────────────

export interface FaucetStatus {
  isOpen: boolean;
  closeTime: bigint;
  isEligible: boolean;
  hasClaimedLobsters: boolean;
  hasClaimedGold: boolean;
  /** D-10: a lobster claim is two steps. 0 = never requested. */
  lobsterClaimId: bigint;
  /** Requested but not minted yet (the keeper finalizes a couple of blocks later). */
  lobsterClaimPending: boolean;
  /** Block whose hash the lobsters are rolled from; 0 when there is no claim. */
  lobsterClaimTargetBlock: bigint;
}

export async function readFaucetStatus(address: string): Promise<FaucetStatus> {
  const c = client();
  const faucet = getFaucet(c);
  const addr = address as `0x${string}`;

  const [isOpen, closeTime, isEligible, hasClaimedLobsters, hasClaimedGold, claimId] = await Promise.all([
    faucet.read.isFaucetOpen(),
    faucet.read.closeTime(),
    faucet.read.isEligible([addr]),
    faucet.read.hasClaimedLobsters([addr]),
    faucet.read.hasClaimedGold([addr]),
    faucet.read.claimIdOf([addr]),
  ]);
  const lobsterClaimId = claimId as bigint;
  const claim = lobsterClaimId > 0n ? ((await faucet.read.getClaim([lobsterClaimId])) as { finalized: boolean; targetBlock: bigint }) : null;

  return {
    isOpen: isOpen as boolean,
    closeTime: closeTime as bigint,
    isEligible: isEligible as boolean,
    hasClaimedLobsters: hasClaimedLobsters as boolean,
    hasClaimedGold: hasClaimedGold as boolean,
    lobsterClaimId,
    lobsterClaimPending: !!claim && !claim.finalized,
    lobsterClaimTargetBlock: claim ? BigInt(claim.targetBlock) : 0n,
  };
}

// ──────────── Breeding ────────────

export async function readCooldownEnd(lobsterId: bigint): Promise<bigint> {
  const c = client();
  const lab = getBreedingLab(c);
  return lab.read.getCooldownEnd([lobsterId]) as Promise<bigint>;
}

// ──────────── Marketplace ────────────

export interface ChainListing {
  listingId: bigint;
  seller: string;
  lobsterId: bigint;
  price: bigint;
  active: boolean;
}

export async function readListing(listingId: bigint): Promise<ChainListing> {
  const c = client();
  const market = getMarketplace(c);

  try {
    const data = await market.read.getListing([listingId]);
    return {
      listingId,
      seller: data.seller as string,
      lobsterId: data.lobsterId,
      price: data.price,
      active: data.active,
    };
  } catch {
    throw new ApiError('NOT_FOUND', `Listing #${listingId} not found`);
  }
}

// ──────────── Battle ────────────

export interface ChainBattle {
  battleId: bigint;
  playerA: string;
  playerB: string;
  teamIdA: bigint;
  teamIdB: bigint;
  stakeAmount: bigint;
  /** D-E: the bracket the matchmaker named (0 Low / 1 Mid / 2 High). `stakeAmount` is what the
   *  peg bound at createBattle — read it from here, never from a constant. */
  bracket: number;
  phase: number;
  winner: string;
  depositA: boolean;
  depositB: boolean;
  teamCommitA: string;
  teamCommitB: string;
  teamRevealedA: boolean;
  teamRevealedB: boolean;
  /** V3 settle proposal, populated from AwaitingFinalize onward. `proposedWinner`
   *  is address(0) for a draw; the two hashes commit to the off-chain battle
   *  (canonical final state; {battleId, VRF seed, layout, roster, turn log}). */
  proposedWinner: string;
  finalStateHash: string;
  turnLogHash: string;
  /** D-01: commitment to the battle's seed secret and the reveal timestamp that fixes its drand
   *  round — both set by revealTeams. The secret itself is disclosed on-chain by settle(). */
  seedCommit: string;
  revealedAt: number;
  /** X13: deadline clocks for the handleTimeout button. The contract uses `phaseDeadline`
   *  for Deposit/TeamReveal/Active, `payoutDeadline` (the end of the review window) for
   *  AwaitingFinalize and `frozenAt + FREEZE_LONG_STOP` for Frozen. Unix seconds. */
  phaseDeadline: bigint;
  payoutDeadline: bigint;
  /** D-08: Team Power each side was matched at (3..9), bound on-chain by createBattle. */
  powerA: number;
  powerB: number;
  /** The player settle() named as having resigned / timed out three times (zero address if
   *  nobody); they lose their 5% anti-grief deposit at payout. */
  proposedForfeiter: string;
  /** Unix seconds the watchdog (or the Safe) froze the result, 0 unless phase = Frozen (8). */
  frozenAt: number;
  /** D-14 reveal-failure attribution: the resolver reported that this side's commit does not
   *  open with the salt it handed over; `opened*` = the player then opened it themselves. */
  accusedA: boolean;
  accusedB: boolean;
  openedA: boolean;
  openedB: boolean;
}

export async function readBattle(battleId: bigint): Promise<ChainBattle> {
  const c = client();
  const arena = getBattleArena(c);

  try {
    const data = await arena.read.getBattle([battleId]);

    return {
      battleId,
      playerA: data.playerA as string,
      playerB: data.playerB as string,
      teamIdA: data.teamIdA,
      teamIdB: data.teamIdB,
      stakeAmount: data.stakeAmount,
      bracket: Number(data.bracket),
      phase: data.phase,
      winner: data.winner as string,
      depositA: data.depositA,
      depositB: data.depositB,
      teamCommitA: data.teamCommitA as string,
      teamCommitB: data.teamCommitB as string,
      teamRevealedA: data.teamRevealedA,
      teamRevealedB: data.teamRevealedB,
      proposedWinner: data.proposedWinner as string,
      finalStateHash: data.finalStateHash as string,
      turnLogHash: data.turnLogHash as string,
      seedCommit: data.seedCommit as string,
      revealedAt: Number(data.revealedAt),
      // X13: expose deadlines for the handleTimeout button.
      phaseDeadline: data.phaseDeadline,
      payoutDeadline: data.payoutDeadline,
      // D-08: the Powers the matchmaker bound on-chain, for the deposit-consent check.
      powerA: Number(data.powerA),
      powerB: Number(data.powerB),
      proposedForfeiter: data.proposedForfeiter as string,
      frozenAt: Number(data.frozenAt),
      accusedA: data.accusedA,
      accusedB: data.accusedB,
      openedA: data.openedA,
      openedB: data.openedB,
    };
  } catch {
    throw new ApiError('NOT_FOUND', `Battle #${battleId} not found`);
  }
}

/** Chain time (latest block timestamp, seconds). The contract judges every deadline by
 *  block.timestamp, which drifts from the server clock — and jumps on a local chain. */
export async function readChainTime(): Promise<bigint> {
  try {
    return (await client().getBlock({ blockTag: 'latest' })).timestamp as bigint;
  } catch {
    throw new ApiError('CHAIN_ERROR', 'Could not read the latest block');
  }
}

// ──────────── D-E: stake quote ────────────

/** D-E: the three bracket stakes as the chain quotes them right now, with the peg's inputs. The
 *  amount a battle binds is whatever `createBattle` computes when the engine submits it — the
 *  quote moves at a season-day boundary (the reference re-samples) or when the Safe enacts a new
 *  fixed share. Everything is wei. */
export interface StakeQuote {
  brackets: Array<{ bracket: 0 | 1 | 2; label: 'Low' | 'Mid' | 'High'; stakeWei: bigint; launchStakeWei: bigint }>;
  peg: {
    /** MiningPool.stakeReference — the base reward sampled once per season-day (0 before the first season). */
    stakeReferenceWei: bigint;
    /** MiningPool.currentBaseReward — the live rate (the fallback before the first sample). */
    liveBaseRewardWei: bigint;
    /** The reference the peg actually used, after the fallbacks and the genesis cap. */
    effectiveReferenceWei: bigint;
    genesisBaseRewardWei: bigint;
    /** Share of each stake anchored to genesis, in bps; the rest follows the reference. */
    fixedBps: bigint;
  };
}

export async function readStakeQuote(): Promise<StakeQuote> {
  const c = client();
  const arena = getBattleArena(c);
  const pool = getMiningPool(c);
  try {
    const [stakes, fixedBps, genesis, stakeReference, live] = (await Promise.all([
      arena.read.currentStakes(),
      arena.read.stakeFixedBps(),
      arena.read.GENESIS_BASE_REWARD(),
      pool.read.stakeReference(),
      pool.read.currentBaseReward(),
    ])) as [readonly bigint[], bigint, bigint, bigint, bigint];
    return {
      brackets: ([0, 1, 2] as const).map((b) => ({
        bracket: b,
        label: STAKE_BRACKET_LABELS[b],
        stakeWei: stakes[b],
        launchStakeWei: LAUNCH_STAKES[b] * 10n ** 18n,
      })),
      peg: {
        stakeReferenceWei: stakeReference,
        liveBaseRewardWei: live,
        effectiveReferenceWei: stakeReferenceWei(stakeReference, live),
        genesisBaseRewardWei: genesis,
        fixedBps,
      },
    };
  } catch {
    throw new ApiError('CHAIN_ERROR', 'Could not read the stake brackets from the chain');
  }
}

// ──────────── BigInt serialization ────────────

export function serializeBigInts<T>(obj: T): T {
  if (typeof obj === 'bigint') return obj.toString() as unknown as T;
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(serializeBigInts) as unknown as T;
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInts(value);
    }
    return result as T;
  }
  return obj;
}
