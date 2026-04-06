/**
 * Placeholder lobster and listing data for marketplace development.
 * Uses static class character PNGs instead of DNA-rendered images.
 */

import type { LobsterData } from './api';

// Class names match the order in CLASS_NAMES_LIST
const CLASSES = [
  'Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter',
  'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember',
] as const;

const ROLES = [
  'Tank', 'Assassin', 'Bruiser', 'Nuker', 'Debuffer',
  'Support', 'DPS', 'Lifesteal', 'Controller', 'Glass Cannon',
] as const;

const TIER_NAMES = ['Base', 'Evolved', 'Elite', 'Apex'] as const;

// Base stats per class (from game design), scaled by evolution tier
const BASE_STATS: Record<number, { hp: number; attack: number; armor: number; speed: number; critical: number }> = {
  0: { hp: 700, attack: 70, armor: 120, speed: 80, critical: 90 },   // Bulwark
  1: { hp: 375, attack: 100, armor: 70, speed: 130, critical: 125 }, // Mantis
  2: { hp: 600, attack: 130, armor: 100, speed: 70, critical: 80 },  // Leviathan
  3: { hp: 450, attack: 110, armor: 80, speed: 105, critical: 115 }, // Tempest
  4: { hp: 425, attack: 85, armor: 85, speed: 125, critical: 120 },  // Specter
  5: { hp: 650, attack: 70, armor: 110, speed: 90, critical: 100 },  // Sentinel
  6: { hp: 475, attack: 120, armor: 80, speed: 110, critical: 95 },  // Reaver
  7: { hp: 525, attack: 110, armor: 90, speed: 95, critical: 100 },  // Abyss
  8: { hp: 550, attack: 90, armor: 100, speed: 105, critical: 95 },  // Kraken
  9: { hp: 350, attack: 140, armor: 60, speed: 100, critical: 130 }, // Ember
};

const TIER_MULT = [1.0, 1.2, 1.4, 1.6];

function scaleStats(classId: number, tier: number, isLegend: boolean) {
  const base = BASE_STATS[classId];
  const mult = TIER_MULT[tier] * (isLegend ? 1.1 : 1.0);
  return {
    hp: String(Math.round(base.hp * mult)),
    attack: String(Math.round(base.attack * mult)),
    armor: String(Math.round(base.armor * mult)),
    speed: String(Math.round(base.speed * mult)),
    critical: String(Math.round(base.critical * mult)),
  };
}

/** Deterministic PRNG matching the render script's seededRng */
function seededRng(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; return s; };
}

/**
 * Generate body parts deterministically from seed.
 * Dominant alleles have a weighted chance of matching the lobster's class (~60%),
 * producing natural purity variation. Must match the render script exactly.
 */
function makeDeterministicBodyParts(classId: number, seed: number) {
  const rng = seededRng(seed);
  return Array.from({ length: 6 }, () => {
    const roll = rng() % 100;
    // ~60% chance dominant matches class, ~40% random other class
    const domClass = roll < 60 ? classId : rng() % 10;
    return {
      dominant: { classAffinity: domClass, variant: rng() % 16 },
      r1: { classAffinity: rng() % 10, variant: rng() % 16 },
      r2: { classAffinity: rng() % 10, variant: rng() % 16 },
    };
  });
}

const MOCK_SELLERS = [
  '0x1a2b3c4d5e6f7890abcdef1234567890abcdef12',
  '0xdeadbeef00000000000000000000000000000001',
  '0xcafe1234567890abcdef1234567890abcdef0000',
  '0x00000000000000000000000000000000000a9e47',
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
];

interface MockLobsterConfig {
  tokenId: string;
  classId: number;
  tier: number;
  purity: number;
  legend: number;
  damage: number;
  breedCount: number;
  generation: number;
  soulbound: boolean;
  locked: boolean;
  price: string;
  seller: number; // index into MOCK_SELLERS
}

const MOCK_CONFIGS: MockLobsterConfig[] = [
  // Variety: all 10 classes, different tiers/purities/prices
  { tokenId: '1042', classId: 0, tier: 2, purity: 4, legend: 0, damage: 0, breedCount: 2, generation: 1, soulbound: false, locked: false, price: '15999', seller: 0 },
  { tokenId: '873',  classId: 1, tier: 3, purity: 5, legend: 0, damage: 0, breedCount: 0, generation: 2, soulbound: false, locked: false, price: '42000', seller: 1 },
  { tokenId: '2201', classId: 2, tier: 1, purity: 2, legend: 0, damage: 0, breedCount: 1, generation: 0, soulbound: false, locked: false, price: '8500', seller: 2 },
  { tokenId: '557',  classId: 3, tier: 2, purity: 6, legend: 1, damage: 0, breedCount: 3, generation: 3, soulbound: false, locked: false, price: '89000', seller: 0 },
  { tokenId: '1899', classId: 4, tier: 1, purity: 3, legend: 0, damage: 0, breedCount: 1, generation: 1, soulbound: false, locked: false, price: '12000', seller: 3 },
  { tokenId: '3104', classId: 5, tier: 2, purity: 4, legend: 0, damage: 0, breedCount: 0, generation: 0, soulbound: false, locked: false, price: '18500', seller: 4 },
  { tokenId: '764',  classId: 6, tier: 3, purity: 5, legend: 0, damage: 0, breedCount: 2, generation: 2, soulbound: false, locked: false, price: '55000', seller: 1 },
  { tokenId: '2888', classId: 7, tier: 1, purity: 1, legend: 0, damage: 0, breedCount: 4, generation: 1, soulbound: false, locked: false, price: '5200', seller: 2 },
  { tokenId: '445',  classId: 8, tier: 2, purity: 3, legend: 0, damage: 0, breedCount: 1, generation: 1, soulbound: false, locked: false, price: '22000', seller: 3 },
  { tokenId: '1337', classId: 9, tier: 3, purity: 6, legend: 1, damage: 0, breedCount: 0, generation: 4, soulbound: false, locked: false, price: '125000', seller: 0 },
  // More variety — duplicated classes at different tiers/prices
  { tokenId: '99',   classId: 0, tier: 0, purity: 0, legend: 0, damage: 0, breedCount: 0, generation: 0, soulbound: false, locked: false, price: '2500', seller: 4 },
  { tokenId: '2045', classId: 1, tier: 1, purity: 2, legend: 0, damage: 0, breedCount: 1, generation: 1, soulbound: false, locked: false, price: '9800', seller: 3 },
  { tokenId: '3550', classId: 3, tier: 0, purity: 1, legend: 0, damage: 0, breedCount: 0, generation: 0, soulbound: false, locked: false, price: '3200', seller: 1 },
  { tokenId: '1576', classId: 6, tier: 2, purity: 4, legend: 0, damage: 0, breedCount: 3, generation: 2, soulbound: false, locked: false, price: '28000', seller: 2 },
  { tokenId: '4012', classId: 8, tier: 1, purity: 2, legend: 0, damage: 0, breedCount: 0, generation: 0, soulbound: false, locked: false, price: '7500', seller: 4 },
  { tokenId: '888',  classId: 5, tier: 3, purity: 5, legend: 1, damage: 0, breedCount: 1, generation: 3, soulbound: false, locked: false, price: '98000', seller: 0 },
];

function buildLobster(cfg: MockLobsterConfig): LobsterData {
  const isLegend = cfg.legend > 0;
  const bodyParts = makeDeterministicBodyParts(cfg.classId, parseInt(cfg.tokenId) || 0);
  const purity = bodyParts.filter(bp => bp.dominant.classAffinity === cfg.classId).length;
  return {
    tokenId: cfg.tokenId,
    owner: MOCK_SELLERS[cfg.seller],
    dna: '0',
    class: cfg.classId,
    className: CLASSES[cfg.classId],
    classRole: ROLES[cfg.classId],
    legend: cfg.legend,
    breedType: 0,
    purity,
    evolutionTier: cfg.tier,
    tierName: TIER_NAMES[cfg.tier],
    damage: cfg.damage,
    breedCount: cfg.breedCount,
    generation: cfg.generation,
    soulbound: cfg.soulbound,
    locked: cfg.locked,
    stats: scaleStats(cfg.classId, cfg.tier, isLegend),
    bodyParts,
  };
}

export const MOCK_LOBSTERS: LobsterData[] = MOCK_CONFIGS.map(buildLobster);

export interface MockListing {
  listingId: string;
  tokenId: string;
  seller: string;
  price: string;
  listedAt: number;
  isEgg: boolean;
  lobster: LobsterData;
}

const LOBSTER_LISTINGS: MockListing[] = MOCK_CONFIGS.map((cfg, i) => ({
  listingId: `mock-${i}`,
  tokenId: cfg.tokenId,
  seller: MOCK_SELLERS[cfg.seller],
  price: cfg.price,
  listedAt: Date.now() / 1000 - i * 3600,
  isEgg: false,
  lobster: buildLobster(cfg),
}));

/** Egg listings — unhatched, class/stats unknown to buyer */
const EGG_LISTINGS: MockListing[] = [
  {
    listingId: 'egg-1',
    tokenId: '5001',
    seller: MOCK_SELLERS[0],
    price: '4500',
    listedAt: Date.now() / 1000 - 1800,
    isEgg: true,
    lobster: { ...buildLobster({ tokenId: '5001', classId: 0, tier: 0, purity: 0, legend: 0, damage: 0, breedCount: 0, generation: 1, soulbound: false, locked: false, price: '4500', seller: 0 }), className: 'Unknown', classRole: 'Egg' },
  },
  {
    listingId: 'egg-2',
    tokenId: '5002',
    seller: MOCK_SELLERS[2],
    price: '6200',
    listedAt: Date.now() / 1000 - 5400,
    isEgg: true,
    lobster: { ...buildLobster({ tokenId: '5002', classId: 0, tier: 0, purity: 0, legend: 0, damage: 0, breedCount: 0, generation: 2, soulbound: false, locked: false, price: '6200', seller: 2 }), className: 'Unknown', classRole: 'Egg' },
  },
  {
    listingId: 'egg-3',
    tokenId: '5003',
    seller: MOCK_SELLERS[4],
    price: '3800',
    listedAt: Date.now() / 1000 - 7200,
    isEgg: true,
    lobster: { ...buildLobster({ tokenId: '5003', classId: 0, tier: 0, purity: 0, legend: 0, damage: 0, breedCount: 0, generation: 1, soulbound: false, locked: false, price: '3800', seller: 4 }), className: 'Unknown', classRole: 'Egg' },
  },
];

/** Bulk-generated listings (328 extra lobsters) */
import extraListingsData from './mock-extra-listings.json';

const EXTRA_LISTINGS: MockListing[] = (extraListingsData as Array<{
  tokenId: string; classId: number; tier: number; legend: number;
  purity: number; breedCount: number; generation: number; price: string; seller: string;
}>).map((cfg, i) => ({
  listingId: `extra-${i}`,
  tokenId: cfg.tokenId,
  seller: cfg.seller,
  price: cfg.price,
  listedAt: Date.now() / 1000 - (i + 20) * 1800,
  isEgg: false,
  lobster: buildLobster({
    tokenId: cfg.tokenId,
    classId: cfg.classId,
    tier: cfg.tier,
    purity: cfg.purity,
    legend: cfg.legend,
    damage: 0,
    breedCount: cfg.breedCount,
    generation: cfg.generation,
    soulbound: false,
    locked: false,
    price: cfg.price,
    seller: MOCK_SELLERS.indexOf(cfg.seller) >= 0 ? MOCK_SELLERS.indexOf(cfg.seller) : 0,
  }),
}));

export const MOCK_LISTINGS: MockListing[] = [...LOBSTER_LISTINGS, ...EGG_LISTINGS, ...EXTRA_LISTINGS];

const TIER_FOLDERS = ['base', 'evolved', 'elite', 'apex'] as const;

/** Get the static class character image path, optionally at a specific evolution tier */
export function classImagePath(classId: number, evolutionTier = 0): string {
  const name = CLASSES[classId]?.toLowerCase();
  const tier = TIER_FOLDERS[evolutionTier] ?? 'base';
  return name ? `/assets/characters/${tier}/${name}.png` : '/assets/characters/base/bulwark.png';
}

/** Get the pre-rendered marketplace lobster image for a specific token ID */
export function marketLobsterImage(tokenId: string): string {
  return `/assets/characters/market/lobster-${tokenId}.png`;
}

/** Class accent colors for card backgrounds */
export const CLASS_CARD_COLORS: Record<number, string> = {
  0: '#4682B4', // Bulwark
  1: '#00A86B', // Mantis
  2: '#000080', // Leviathan
  3: '#48BEC8', // Tempest
  4: '#7B68EE', // Specter
  5: '#66D0BC', // Sentinel
  6: '#DC1400', // Reaver
  7: '#00D616', // Abyss
  8: '#008080', // Kraken
  9: '#CD7000', // Ember
};
