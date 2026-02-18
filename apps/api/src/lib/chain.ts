import {
  getPublicClient,
  getLobsterNFT,
  getTeamManager,
  getMiningPool,
  getFaucet,
  getBreedingLab,
  getMarketplace,
  getBattleArena,
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
  const c = client();
  const nft = getLobsterNFT(c);
  const nextId = await nft.read.nextTokenId();
  const lobsters: ChainLobster[] = [];

  // Batch ownership checks (known perf concern — indexer replaces later)
  const batchSize = 50;
  for (let start = 1n; start < nextId; start += BigInt(batchSize)) {
    const end = start + BigInt(batchSize) > nextId ? nextId : start + BigInt(batchSize);
    const checks = [];
    for (let id = start; id < end; id++) {
      checks.push(
        nft.read.ownerOf([id]).then(
          (owner: string) => ({ id, owner: owner as string, exists: true }),
          () => ({ id, owner: '', exists: false }),
        ),
      );
    }

    const results = await Promise.all(checks);
    const owned = results.filter(
      (r) => r.exists && r.owner.toLowerCase() === ownerAddress.toLowerCase(),
    );

    if (owned.length > 0) {
      const lobsterPromises = owned.map((r) => readLobster(r.id));
      const batch = await Promise.all(lobsterPromises);
      lobsters.push(...batch);
    }
  }

  return lobsters;
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

export async function readExpedition(expeditionId: bigint): Promise<ChainExpedition> {
  const c = client();
  const pool = getMiningPool(c);

  try {
    const data = await pool.read.getExpedition([expeditionId]);
    const now = BigInt(Math.floor(Date.now() / 1000));
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
  };
}

export async function readCurrentSeason(): Promise<bigint> {
  const c = client();
  const pool = getMiningPool(c);
  return pool.read.currentSeason() as Promise<bigint>;
}

// ──────────── Faucet ────────────

export interface FaucetStatus {
  isOpen: boolean;
  closeTime: bigint;
  isEligible: boolean;
  hasClaimedLobsters: boolean;
  hasClaimedClaw: boolean;
}

export async function readFaucetStatus(address: string): Promise<FaucetStatus> {
  const c = client();
  const faucet = getFaucet(c);
  const addr = address as `0x${string}`;

  const [isOpen, closeTime, isEligible, hasClaimedLobsters, hasClaimedClaw] = await Promise.all([
    faucet.read.isFaucetOpen(),
    faucet.read.closeTime(),
    faucet.read.isEligible([addr]),
    faucet.read.hasClaimedLobsters([addr]),
    faucet.read.hasClaimedClaw([addr]),
  ]);

  return {
    isOpen: isOpen as boolean,
    closeTime: closeTime as bigint,
    isEligible: isEligible as boolean,
    hasClaimedLobsters: hasClaimedLobsters as boolean,
    hasClaimedClaw: hasClaimedClaw as boolean,
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
  phase: number;
  currentRound: number;
  winner: string;
  depositA: boolean;
  depositB: boolean;
  teamCommitA: string;
  teamCommitB: string;
  teamRevealedA: boolean;
  teamRevealedB: boolean;
  roundCommitA: string;
  roundCommitB: string;
  roundRevealedA: boolean;
  roundRevealedB: boolean;
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
      phase: data.phase,
      currentRound: data.currentRound,
      winner: data.winner as string,
      depositA: data.depositA,
      depositB: data.depositB,
      teamCommitA: data.teamCommitA as string,
      teamCommitB: data.teamCommitB as string,
      teamRevealedA: data.teamRevealedA,
      teamRevealedB: data.teamRevealedB,
      roundCommitA: data.roundCommitA as string,
      roundCommitB: data.roundCommitB as string,
      roundRevealedA: data.roundRevealedA,
      roundRevealedB: data.roundRevealedB,
    };
  } catch {
    throw new ApiError('NOT_FOUND', `Battle #${battleId} not found`);
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
