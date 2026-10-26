/**
 * Arena music — a looping HTML5 <audio> bed under the battle, owned by React rather than
 * Unity. Same pattern as the landing-page theme (music-toggle.tsx), and for the same reasons
 * it beats bundling: the track streams progressively (plays within a second of a 2.8 MB
 * file), is cached by the browser independently of Unity rebuilds (content-hashed URL, served
 * immutable), only the arena you enter is downloaded, and decoding is incremental instead of
 * ~69 MB of PCM per track in the WebGL heap.
 *
 * The track simply loops if a battle outlasts it (fade-out tail and all — chosen, not a bug),
 * fades in as the battle begins and out as it ends. It honours the BATTLE music preference
 * (`clawbada_battle_music`, the in-battle options menu) — separate from the site theme's (user 2026-09-28) — and
 * reacts to it live via `clawbada:battle-music`. The theme fades out as soon as a battle view opens (before Unity
 * loads) and comes back when the view closes, if the site music is on.
 *
 * A Dojo entry starts the bed EARLY (owner 2026-10-25): with the loading screen's breeze, at the Train press
 * (startEntryArenaMusic), and it plays on through the Unity training scene into the battle, which adopts it instead of
 * starting its own — same track, no restart, no second fade. A cancelled entry stops it (cancelEntryArenaMusic).
 */
import { ARENA_MUSIC, type ArenaTier } from './arena-music.generated';
import { getThemeAudio } from '@/components/music-toggle';
import { fadeLevel, isSmooth, levelOf, setLevel } from './audio-graph';
import { BATTLE_MUSIC_EVENT, VOLUME_EVENT, getBattleMusicPref, getBattleMusicVolume, getMusicPref } from './audio-prefs';
export { BATTLE_MUSIC_EVENT };

const FULL_GAIN = 0.35;     // 100% on the volume row; under Unity's SFX at 0.5 and the theme's 0.4
/** The bed's level right now: FULL_GAIN × the player's battle-music volume (default 50%). */
const gain = () => FULL_GAIN * getBattleMusicVolume() / 100;
const FADE_IN_MS = 1500;
/** The battle-start intro's music beat: the bed creeps in under the team reveal (user 2026-09-29). */
export const INTRO_FADE_IN_MS = 3000;
const FADE_OUT_MS = 2000;

let audio: HTMLAudioElement | null = null;
let activeTier: ArenaTier | null = null;   // non-null while a battle is in progress
let activeUrl: string | null = null;       // the track picked for this battle (kept if music is toggled off and on)
/** A bed started by the battle entry and not yet adopted by its battle (between the Train press and the intro). */
let entry: { tier: ArenaTier; url: string } | null = null;
const ENTRY_FADE_IN_MS = 1000;   // with the breeze (entry-ambience BREEZE_FADE_IN_MS)
const remembered = (battleId: string) => { try { return sessionStorage.getItem(`clawbada_arena_track:${battleId}`); } catch { return null; } };
const remember = (battleId: string, url: string) => { try { sessionStorage.setItem(`clawbada_arena_track:${battleId}`, url); } catch { /* private mode */ } };
let themeWasPlaying = false;

const log = (...a: unknown[]) => console.log('[ArenaMusic]', ...a);
const prefOff = () => !getBattleMusicPref();
const THEME_GAIN = 0.4;
const THEME_FADE_MS = 800;
/** Coming out of a battle the theme waits, then eases back in (owner 2026-10-26: dropping straight into it was
 *  jarring). A battle view that opens during the wait cancels it; the theme still returns after that battle. */
export const THEME_RETURN_DELAY_MS = 3000;
export const THEME_RETURN_FADE_MS = 3000;
let themeReturn: { wait: number | null; fade: number | null } = { wait: null, fade: null };

/** Stop a pending or in-progress theme return (a battle view opened); the theme counts as "was playing" again. */
function cancelThemeReturn() {
  if (themeReturn.wait === null && themeReturn.fade === null) return;
  if (themeReturn.wait !== null) window.clearTimeout(themeReturn.wait);
  if (themeReturn.fade !== null) window.clearInterval(themeReturn.fade);
  themeReturn = { wait: null, fade: null };
  themeWasPlaying = true;
  const theme = getThemeAudio();
  if (!theme.paused) { theme.pause(); theme.volume = THEME_GAIN; }
  log('theme return cancelled — a battle view opened');
}
let inBattleView = false;

/** True while a battle view is open (the theme stays off, whatever its toggle says). */
export function isArenaMusicActive(): boolean { return activeTier !== null || inBattleView; }

/** A battle view opened: fade the site theme out now — before Unity loads — and remember to bring it back. */
export function enterBattleView() {
  inBattleView = true;
  cancelThemeReturn();
  const theme = getThemeAudio();
  if (theme.paused) return;
  themeWasPlaying = true;
  const from = theme.volume, start = performance.now();
  const timer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / THEME_FADE_MS);
    theme.volume = from * (1 - t);
    if (t >= 1) { window.clearInterval(timer); theme.pause(); theme.volume = THEME_GAIN; log('theme faded out for the battle'); }
  }, 50);
}

/** The battle view closed: the theme returns if it was playing and the site music is still on. */
export function leaveBattleView() {
  inBattleView = false;
  if (entry) {
    // Left before the battle took the entry's bed — unless a battle view comes straight back (React's dev-mode
    // mount → unmount → mount): cancel only if none has returned shortly after.
    window.setTimeout(() => { if (!inBattleView) cancelEntryArenaMusic(); }, 500);
    return;
  }
  if (activeTier !== null) return;   // stopArenaMusic hands back once its fade ends
  resumeThemeIfWanted();
}

function resumeThemeIfWanted() {
  if (themeWasPlaying && getMusicPref() && !inBattleView && themeReturn.wait === null && themeReturn.fade === null) {
    log(`theme returns in ${THEME_RETURN_DELAY_MS} ms, easing in over ${THEME_RETURN_FADE_MS} ms`);
    themeReturn.wait = window.setTimeout(() => {
      themeReturn.wait = null;
      if (inBattleView || activeTier !== null || entry || !getMusicPref()) return;
      const theme = getThemeAudio();
      theme.volume = 0;
      theme.play().catch(() => {});
      const start = performance.now();
      themeReturn.fade = window.setInterval(() => {
        const t = Math.min(1, (performance.now() - start) / THEME_RETURN_FADE_MS);
        theme.volume = THEME_GAIN * t;
        if (t >= 1) { window.clearInterval(themeReturn.fade!); themeReturn.fade = null; log('theme back'); }
      }, 50);
    }, THEME_RETURN_DELAY_MS);
  }
  themeWasPlaying = false;
}

/** Fades run on the audio thread (lib/audio-graph.ts): page work — the Dojo → battle switch, Unity starting — can't
 *  stall a ramp and make it jump (the owner's stutter as the music's fade-in ended, 2026-10-26). */
function fadeTo(target: number, ms: number, then?: () => void) {
  if (!audio) return;
  fadeLevel(audio, target, ms, then);
}

/** One of the tier's tracks for this battle (owner 2026-10-25: the Dojo has two, one per battle at random). Picked from
 *  the battle id, so every new battle is a coin toss but a reload or reconnect of the same battle keeps its track. */
export function pickArenaTrack(tier: ArenaTier, battleId?: string): string | null {
  const list = ARENA_MUSIC[tier];
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  if (!battleId) return list[Math.floor(Math.random() * list.length)];
  const kept = remembered(battleId);   // the entry's pick for this battle (a reload keeps it)
  if (kept && list.includes(kept)) return kept;
  let h = 2166136261;   // FNV-1a
  for (let i = 0; i < battleId.length; i++) { h ^= battleId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list[(h >>> 0) % list.length];
}

function play(tier: ArenaTier, fadeMs = FADE_IN_MS) {
  const url = activeUrl;
  if (!url) { log(`no track for ${tier} — silent`); return; }
  if (!audio || !audio.src.endsWith(url)) {
    audio?.pause();
    audio = new Audio(url);
    audio.loop = true;
    audio.preload = 'auto';
  }
  setLevel(audio, 0);
  const t0 = performance.now();
  audio.play().then(() => {
    log(`${url.split('/').pop()} (${tier}) playing after ${Math.round(performance.now() - t0)} ms → fade to ${gain().toFixed(3)} over ${fadeMs} ms`);
    fadeTo(gain(), fadeMs);
  }).catch((e) => log('play blocked:', e?.name ?? e));
  (window as unknown as { __clawbadaArenaMusic?: unknown }).__clawbadaArenaMusic = { audio, tier, get level() { return audio ? levelOf(audio) : null; }, get smooth() { return audio ? isSmooth(audio) : false; } };
}

/** Call when the battle is known: starts the bed for that arena (unless music is off). */
export function startArenaMusic(tier: ArenaTier, fadeMs = FADE_IN_MS, battleId?: string) {
  cancelThemeReturn();
  if (entry && entry.tier === tier) {
    // The entry already has this arena's bed going: adopt it — the same track carries on, no restart, no second fade.
    activeTier = tier;
    activeUrl = entry.url;
    entry = null;
    if (battleId) remember(battleId, activeUrl);
    if (audio && !audio.paused) { log(`${activeUrl.split('/').pop()} (${tier}) carried on from the loading screen`); fadeTo(gain(), 600); return; }
    if (prefOff()) { log(`battle music is off — ${tier} bed not started`); return; }
    play(tier, fadeMs);
    return;
  }
  if (entry) cancelEntryArenaMusic();   // a different arena after all: drop the entry's bed
  activeTier = tier;
  activeUrl = pickArenaTrack(tier, battleId);
  if (ARENA_MUSIC[tier].length > 1) log(`${tier}: ${activeUrl?.split('/').pop()} (1 of ${ARENA_MUSIC[tier].length}) for battle ${battleId ?? '(no id)'}`);
  const theme = getThemeAudio();
  if (!theme.paused) { themeWasPlaying = true; theme.pause(); log('theme paused for the battle'); }
  if (prefOff()) { log(`battle music is off — ${tier} bed not started`); return; }
  play(tier, fadeMs);
}

/** The battle entry began (the Dojo's Train press) and knows its arena: the site theme goes, and the arena's bed fades
 *  in with the breeze after `delayMs` (the navy curtain). The battle adopts it (startArenaMusic). */
export function startEntryArenaMusic(tier: ArenaTier, delayMs = 0) {
  if (activeTier !== null || entry) return;
  cancelThemeReturn();
  const url = pickArenaTrack(tier);
  if (!url) { log(`no track for ${tier} — the entry stays quiet`); return; }
  entry = { tier, url };
  activeUrl = url;
  const theme = getThemeAudio();
  if (!theme.paused) { themeWasPlaying = true; theme.pause(); log('theme paused for the battle entry'); }
  if (prefOff()) { log(`battle music is off — ${tier} bed not started with the entry`); return; }
  window.setTimeout(() => { if (entry && entry.url === url) play(tier, ENTRY_FADE_IN_MS); }, delayMs);
  log(`${url.split('/').pop()} (${tier}) starts with the loading screen`);
}

/** The entry was abandoned before its battle took the bed: fade it out and give the theme back. */
export function cancelEntryArenaMusic() {
  if (!entry) return;
  entry = null;
  const back = () => { if (!inBattleView && activeTier === null) resumeThemeIfWanted(); };
  if (audio && !audio.paused) { log('entry cancelled — bed fades out'); fadeTo(0, 600, () => { audio?.pause(); back(); }); }
  else back();
}

/** Call when the battle ends or the view unmounts: fades out, then hands back to the theme. */
export function stopArenaMusic() {
  if (activeTier === null) return;
  activeTier = null;
  const resumeTheme = () => { if (!inBattleView) resumeThemeIfWanted(); };
  if (audio && !audio.paused) {
    log(`fade out over ${FADE_OUT_MS} ms`);
    fadeTo(0, FADE_OUT_MS, () => { audio?.pause(); resumeTheme(); });
  } else resumeTheme();
}

// Live reaction to the toggle: off → fade the bed out; on mid-battle → start it.
if (typeof window !== 'undefined') {
  window.addEventListener(BATTLE_MUSIC_EVENT, (e) => {
    const on = (e as CustomEvent<'on' | 'off'>).detail === 'on';
    const tier = activeTier ?? entry?.tier ?? null;
    if (tier === null) return;
    if (!on && audio && !audio.paused) { log('toggled off — fading out'); fadeTo(0, 600, () => audio?.pause()); }
    if (on && (!audio || audio.paused)) play(tier);
  });
  // Volume row: glide to the new level (a quick fade, so a step doesn't click).
  window.addEventListener(VOLUME_EVENT, () => {
    if ((activeTier === null && !entry) || !audio || audio.paused) return;
    log(`volume → ${getBattleMusicVolume()}%`);
    fadeTo(gain(), 200);
  });
}
