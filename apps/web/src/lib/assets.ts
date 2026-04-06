/**
 * Asset path constants for pixel art assets.
 *
 * All paths are relative to /public/assets/. When an asset file hasn't been
 * delivered yet, components fall back to emoji or Lucide icons via PixelIcon.
 */

const A = '/assets';

// ── Scene backgrounds ──

export const BACKGROUNDS = {
  // Mining — tiered
  mineBase: `${A}/backgrounds/bg-mine-base.png`,
  mineEvolved: `${A}/backgrounds/bg-mine-evolved.png`,
  mineElite: `${A}/backgrounds/bg-mine-elite.png`,
  mineApex: `${A}/backgrounds/bg-mine-apex.png`,

  // Battle arenas — tiered, 2 scenes each (no Base — battles require Evolved+)
  arenaEvolved1: `${A}/backgrounds/bg-arena-evolved-1.png`,
  arenaEvolved2: `${A}/backgrounds/bg-arena-evolved-2.png`,
  arenaElite1: `${A}/backgrounds/bg-arena-elite-1.png`,
  arenaElite2: `${A}/backgrounds/bg-arena-elite-2.png`,
  arenaApex1: `${A}/backgrounds/bg-arena-apex-1.png`,
  arenaApex2: `${A}/backgrounds/bg-arena-apex-2.png`,

  // Page-specific
  landing: `${A}/backgrounds/bg-landing.png`,
  dashboard: `${A}/backgrounds/bg-dashboard.png`,
  breeding: `${A}/backgrounds/bg-breeding.png`,
  evolution: `${A}/backgrounds/bg-evolution.png`,
  repair: `${A}/backgrounds/bg-repair.png`,
  teams: `${A}/backgrounds/bg-teams.png`,
  market: `${A}/backgrounds/bg-market.png`,
  faucet: `${A}/backgrounds/bg-faucet.png`,
  leaderboard: `${A}/backgrounds/bg-leaderboard.png`,
  activity: `${A}/backgrounds/bg-activity.png`,
} as const;

// ── Mine tier backgrounds by index ──
export const MINE_BACKGROUNDS = [
  BACKGROUNDS.mineBase,
  BACKGROUNDS.mineEvolved,
  BACKGROUNDS.mineElite,
  BACKGROUNDS.mineApex,
] as const;

// ── Arena backgrounds by tier index (2 scenes each, no Base tier) ──
// Index 0 = Evolved, 1 = Elite, 2 = Apex (offset by 1 from evolution tier)
export const ARENA_BACKGROUNDS = [
  [BACKGROUNDS.arenaEvolved1, BACKGROUNDS.arenaEvolved2],
  [BACKGROUNDS.arenaElite1, BACKGROUNDS.arenaElite2],
  [BACKGROUNDS.arenaApex1, BACKGROUNDS.arenaApex2],
] as const;

/** Pick a random arena background for a given evolution tier (1=Evolved, 2=Elite, 3=Apex) */
export function getArenaBackground(tier: number): string {
  const scenes = ARENA_BACKGROUNDS[tier - 1];
  if (!scenes) return BACKGROUNDS.arenaEvolved1;
  return scenes[Math.floor(Math.random() * scenes.length)];
}

// ── Icons (32x32, replaces emoji) ──

export const ICONS = {
  // Mine tiers
  mineBase: `${A}/icons/icon-mine-base.png`,
  mineEvolved: `${A}/icons/icon-mine-evolved.png`,
  mineElite: `${A}/icons/icon-mine-elite.png`,
  mineApex: `${A}/icons/icon-mine-apex.png`,

  // Activity feed events
  battle: `${A}/icons/icon-battle.png`,
  breed: `${A}/icons/icon-breed.png`,
  evolve: `${A}/icons/icon-evolve.png`,
  sale: `${A}/icons/icon-sale.png`,
  listing: `${A}/icons/icon-listing.png`,
  mining: `${A}/icons/icon-mining.png`,
  faucet: `${A}/icons/icon-faucet.png`,
  event: `${A}/icons/icon-event.png`,

  // Status
  locked: `${A}/icons/icon-locked.png`,
  soulbound: `${A}/icons/icon-soulbound.png`,
  legend: `${A}/icons/icon-legend.png`,
  timer: `${A}/icons/icon-timer.png`,

  // UI actions
  repair: `${A}/icons/icon-repair.png`,
  team: `${A}/icons/icon-team.png`,
  empty: `${A}/icons/icon-empty.png`,
  trophy: `${A}/icons/icon-trophy.png`,
} as const;

// ── Mine tier icons by index ──
export const MINE_TIER_ICONS = [
  ICONS.mineBase,
  ICONS.mineEvolved,
  ICONS.mineElite,
  ICONS.mineApex,
] as const;

// ── Activity event type to icon mapping ──
export const EVENT_ICONS: Record<string, string> = {
  battle_settled: ICONS.battle,
  lobster_bred: ICONS.breed,
  lobster_evolved: ICONS.evolve,
  listing_sold: ICONS.sale,
  expedition_claimed: ICONS.mining,
  lobster_minted: ICONS.faucet,
  listing_created: ICONS.listing,
};

// ── Tier badges ──

export const TIER_BADGES = [
  `${A}/badges/badge-base.png`,
  `${A}/badges/badge-evolved.png`,
  `${A}/badges/badge-elite.png`,
  `${A}/badges/badge-apex.png`,
] as const;

// ── Hero ──

export const HERO = {
  lobster: `${A}/hero/hero-lobster.png`,
  scene: `${A}/hero/hero-scene.png`,
} as const;

// ── Animated sprite sheets ──

export const SPRITES = {
  bubbles: `${A}/animated/bubbles-sheet.png`,
  sparkle: `${A}/animated/sparkle-sheet.png`,
  coin: `${A}/animated/coin-sheet.png`,
  crack: `${A}/animated/crack-sheet.png`,
  wave: `${A}/animated/wave-sheet.png`,
} as const;

// ── Loading ──

export const LOADING = {
  lobster: `${A}/loading/loading-lobster.png`,
  matchmaking: `${A}/loading/matchmaking-bg.png`,
  seasonBanner: `${A}/loading/season-banner.png`,
} as const;

// ── Emoji fallbacks (used when pixel art PNG hasn't been delivered yet) ──

export const EMOJI_FALLBACKS: Record<string, string> = {
  // Mine tiers
  [ICONS.mineBase]: '\u{1F3D4}\uFE0F',       // 🏔️
  [ICONS.mineEvolved]: '\u{1F30A}',           // 🌊
  [ICONS.mineElite]: '\u{1F311}',             // 🌑
  [ICONS.mineApex]: '\u{1F30B}',              // 🌋

  // Activity events
  [ICONS.battle]: '\u2694\uFE0F',              // ⚔️
  [ICONS.breed]: '\uD83E\uDDEC',              // 🧬
  [ICONS.evolve]: '\u2B50',                    // ⭐
  [ICONS.sale]: '\uD83D\uDCB0',               // 💰
  [ICONS.listing]: '\uD83C\uDFE0',            // 🏠
  [ICONS.mining]: '\u26CF\uFE0F',             // ⛏️
  [ICONS.faucet]: '\uD83E\uDD9E',             // 🦞
  [ICONS.event]: '\uD83D\uDD35',              // 🔵

  // Status
  [ICONS.locked]: '\uD83D\uDD12',             // 🔒
  [ICONS.soulbound]: '\uD83D\uDD17',          // 🔗
  [ICONS.legend]: '\u2728',                    // ✨
  [ICONS.timer]: '\u23F1\uFE0F',              // ⏱️

  // UI
  [ICONS.repair]: '\uD83D\uDD27',             // 🔧
  [ICONS.team]: '\uD83E\uDD9E',               // 🦞
  [ICONS.empty]: '\uD83E\uDD9E',              // 🦞
  [ICONS.trophy]: '\uD83C\uDFC6',             // 🏆
};
