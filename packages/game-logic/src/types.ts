// ──────────── Enums ────────────

export enum LobsterClass {
  Bulwark = 0,
  Mantis = 1,
  Leviathan = 2,
  Tempest = 3,
  Specter = 4,
  Sentinel = 5,
  Reaver = 6,
  Abyss = 7,
  Kraken = 8,
  Ember = 9,
}

export enum EvolutionTier {
  Base = 0,
  Evolved = 1,
  Elite = 2,
  Apex = 3,
}

export enum BodyPart {
  Carapace = 0, // HP
  Claws = 1, // Attack
  Tail = 2, // Speed
  Antennae = 3, // Critical
  Eyes = 4, // Armor
  Legs = 5, // HP
}

export enum MoveType {
  Attack = 0,
  Defend = 1,
  Special = 2,
}

/**
 * F-13: aligned 1:1 with `BattleArena.sol`'s `enum BattlePhase`. Indexer
 * writes the contract's numeric value; off-chain code reads through this
 * enum, so the names and values must match the contract exactly.
 *
 * Off-chain-only states (queue / round commit-reveal sub-phases) belong in
 * a separate enum (`OffchainBattleStage`, below) to avoid colliding with
 * contract-numeric phase values.
 */
export enum BattlePhase {
  None = 0,
  /** Matchmaker → both players deposit stake + anti-grief. */
  Deposit = 1,
  TeamCommit = 2,
  TeamReveal = 3,
  /** Combat in progress (covers all on-chain round commit-reveal cycles). */
  Active = 4,
  /** H-01: settle() proposed a winner; awaiting dispute window or finalize. */
  AwaitingFinalize = 5,
  Settled = 6,
  Cancelled = 7,
  // Pre-F-13 aliases — keep until call sites migrate. New code should use
  // the canonical names above.
  /** @deprecated Use `Deposit`. Pre-F-13 alias for the post-match deposit window. */
  StakeDeposit = 1,
}

/**
 * Off-chain-only battle stages used by the matchmaker / combat engine. NOT
 * stored in the on-chain `Battle.phase` field. Use this enum where the
 * code is reasoning about server-side state that has no contract analogue.
 */
export enum OffchainBattleStage {
  /** Matchmaker has paired but no Battle row exists yet (rare; legacy). */
  Matchmaking = 0,
  /** Off-chain round-commit window after Active. */
  RoundCommit = 100,
  /** Off-chain round-reveal window after RoundCommit. */
  RoundReveal = 101,
  /** Server-side completion, before on-chain Settled lands. */
  Completed = 200,
}

export enum LegendStatus {
  Normal = 0,
  Legend = 1,
  /** Reserved for future seasons (achievement legends, higher tiers). Decodable, never minted in S1. */
  Reserved2 = 2,
  Reserved3 = 3,
}

// ──────────── Interfaces ────────────

export interface Stats {
  hp: bigint;
  attack: bigint;
  armor: bigint;
  speed: bigint;
  critical: bigint;
}

export interface Allele {
  classAffinity: number; // 0-9
  variant: number; // 0-15
}

export interface BodyPartGenes {
  dominant: Allele;
  r1: Allele;
  r2: Allele;
}

export interface DecodedDNA {
  class: LobsterClass;
  legend: LegendStatus;
  breedType: number;
  bodyParts: BodyPartGenes[];
  purity: number;
}

export interface Lobster {
  tokenId: bigint;
  owner: string;
  dna: bigint;
  class: LobsterClass;
  legend: LegendStatus;
  breedType: number;
  purity: number;
  evolutionTier: EvolutionTier;
  damage: number;
  breedCount: number;
  generation: number;
  soulbound: boolean;
  locked: boolean;
}

export interface Team {
  teamId: bigint;
  owner: string;
  lobsterIds: [bigint, bigint, bigint];
  active: boolean;
}

export interface Expedition {
  expeditionId: bigint;
  teamId: bigint;
  owner: string;
  season: number;
  mineTier: EvolutionTier;
  startTime: bigint;
  reward: bigint;
  claimed: boolean;
}

export interface Listing {
  listingId: bigint;
  tokenId: bigint;
  seller: string;
  price: bigint;
  active: boolean;
  listedAt: bigint;
}

export interface BattleMove {
  lobsterSlot: number; // 0-2
  moveType: MoveType;
  targetSlot: number; // 0-2
}

export interface RoundResult {
  round: number;
  actions: RoundAction[];
  teamAHp: [bigint, bigint, bigint];
  teamBHp: [bigint, bigint, bigint];
}

export interface RoundAction {
  actorTeam: 'A' | 'B';
  actorSlot: number;
  moveType: MoveType;
  targetSlot: number;
  damage: bigint;
  isCrit: boolean;
  isEnhanced: boolean;
}

export interface BattleResult {
  battleId: bigint;
  winner: string;
  loser: string;
  winnerPayout: bigint;
  protocolFee: bigint;
  rounds: RoundResult[];
}
