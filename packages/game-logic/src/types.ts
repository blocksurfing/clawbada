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

export enum BattlePhase {
  Matchmaking = 0,
  StakeDeposit = 1,
  TeamCommit = 2,
  TeamReveal = 3,
  RoundCommit = 4,
  RoundReveal = 5,
  Settlement = 6,
  Completed = 7,
  Cancelled = 8,
}

export enum LegendStatus {
  Normal = 0,
  Legend = 1,
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
