import type { Browser } from './cdp';

/**
 * The battle entry sequence (PR feat/battle-entry-web): a guest presses Battle on the Dojo and must see Nzib's
 * loading loop at once, the page in fullscreen, the loop held for at least 12 s, then the arena intro.
 *   bun cdp.ts entry-probe.ts                      # local stack (web :3000)
 *   BASE=https://clawbada-web.vercel.app bun cdp.ts entry-probe.ts
 *   AUTO=1 bun cdp.ts entry-probe.ts                # autoplay the opening turns too: no walk cut off, no watchdog release
 *   AUDIO=1 MUSIC=1 bun cdp.ts entry-probe.ts       # battle music ON: the Dojo track starts with the breeze, carries into the battle
 */
const OUT = process.env.OUT ?? `${import.meta.dir}/out`;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e => ${text === undefined ? 'true' : `(e.textContent || '').trim() === ${JSON.stringify(text)}`}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
/** The overlay as the browser sees it; `age` = ms since its fades began (the overlay stamps data-shown-at), so a
 *  late sample (a stalled dev server) is told apart from a wrong fade. */
const overlay = (b: Browser) => b.eval(`(() => { const o = document.querySelector('[data-testid=battle-entry]'); if (!o) return null; const l = o.querySelector('[data-testid=battle-entry-loop]'); const cs = getComputedStyle(o); return { phase: o.dataset.phase, kind: o.dataset.kind, frame: o.querySelector('canvas')?.dataset.frame ?? null, opacity: cs.opacity, bg: cs.backgroundColor, irisR: o.dataset.irisR ? Number(o.dataset.irisR) : null, irisX: Number(o.dataset.irisX), irisY: Number(o.dataset.irisY), loopR: l?.dataset.irisR ? Number(l.dataset.irisR) : null, loopVisible: l ? getComputedStyle(l).visibility === 'visible' : false, revealed: !!o.dataset.revealedAt, path: location.pathname, age: o.dataset.shownAt ? Math.round(performance.now() - Number(o.dataset.shownAt)) : null }; })()`) as Promise<{ phase: string; kind: string; frame: string | null; opacity: string; bg: string; irisR: number | null; irisX: number; irisY: number; loopR: number | null; loopVisible: boolean; revealed: boolean; path: string; age: number | null } | null>;
/** The breeze's debug handle (lib/entry-ambience.ts): the placeholder url (null until the master exists) and whether it plays. */
/** volume = the audible level (the audio-graph gain once routed through the shared context, else el.volume). */
const breeze = (b: Browser) => b.eval(`(() => { const a = window.__clawbadaEntryAmbience; return a ? { url: a.url, playing: !!a.audio && !a.audio.paused, volume: a.audio ? (a.level ?? a.audio.volume) : null, smooth: !!a.smooth } : null; })()`) as Promise<{ url: string | null; playing: boolean; volume: number | null; smooth: boolean } | null>;
/** The theme's dark navy (#192c53) as the browser reports it. */
const NAVY = 'rgb(25, 44, 83)';
/** The iris (lib/battle-entry.ts, owner 2026-10-27): close 1.4 s + navy beat 0.25 s, then open 0.9 s. */
const IRIS_CLOSE_MS = 1400, NAVY_BEAT_MS = 250, IRIS_OPEN_MS = 900;
/** The Battle button's wind-up before the iris (owner 2026-10-27). */
const WINDUP_MS = 2000;
const CURTAIN_MS = WINDUP_MS + IRIS_CLOSE_MS + NAVY_BEAT_MS, HOLD_MS = 12000, UNITY_HOLD_S = 15;

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => { checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

  // A non-default team, so the summary line proves the page hydrated before the click.
  const autoplay = !!process.env.AUTO;
  // MUTE_OUT=1: every media element is muted at the source — the levels, fades and routing still run, nothing reaches
  // the speakers (2026-10-26: a sound-on probe left playing on the owner's machine).
  if (process.env.MUTE_OUT) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `{ const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { this.muted = true; return p.call(this); }; }` });
  await b.goto(`${BASE}/dojo?team=bulwark,leviathan,sentinel&tier=evolved&purity=2&bot=charger${autoplay ? '&auto=1' : ''}`);
  await b.waitFor(`document.body.innerText.includes('Bulwark · Leviathan · Sentinel, Evolved, purity 2')`, 60000, 250);
  // With audio on, use the owner's own settings (2026-10-24: battle music OFF, its volume 30, SFX on): the wind is
  // ambience and follows the SFX switch, so it must play anyway — it never started while it followed the Music row.
  const musicOn = !!process.env.AUDIO && !!process.env.MUSIC;
  if (process.env.AUDIO) await b.eval(`(() => { localStorage.setItem('clawbada_battle_music', '${musicOn ? 'on' : 'off'}'); localStorage.setItem('clawbada_battle_music_vol', '30'); localStorage.setItem('clawbada_sfx', 'on'); localStorage.removeItem('clawbada_sfx_vol'); })()`);
  await b.sleep(1500);
  ok('no overlay before the press', (await overlay(b)) === null);

  const button = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  const stageBefore = await b.eval(`getComputedStyle(document.querySelector('.dojo-stage')).getPropertyValue('--dojo-stage-scale')`);
  const t0 = Date.now();
  await rectClick(b, '[data-testid=dojo-battle]');
  // First the wind-up: the button compresses and spins with smoke, the page stays put (no overlay, no fullscreen yet).
  await b.sleep(600);
  const wind = await b.eval(`(() => { const btn = document.querySelector('[data-testid=dojo-battle]'); return { launching: btn?.dataset.launching === 'true', transform: btn ? getComputedStyle(btn).transform : 'none', smoke: !!document.querySelector('[data-testid=dojo-smoke]'), overlay: !!document.querySelector('[data-testid=battle-entry]'), fullscreen: !!document.fullscreenElement }; })()`) as { launching: boolean; transform: string; smoke: boolean; overlay: boolean; fullscreen: boolean };
  await b.screenshot(`${OUT}/entry-windup.png`);
  ok('the Battle button winds up first (compress + spin, smoke), no overlay or fullscreen yet', wind.launching && wind.transform !== 'none' && wind.smoke && !wind.overlay && !wind.fullscreen, JSON.stringify(wind));
  const appeared = await b.waitFor(`!!document.querySelector('[data-testid=battle-entry][data-phase=web]')`, 5000, 50);
  const tAppear = Date.now() - t0;
  ok('the iris starts after the 2 s wind-up', appeared && tAppear >= WINDUP_MS - 100 && tAppear <= WINDUP_MS + 1200, `${tAppear} ms`);
  ok('page is fullscreen', await b.eval(`document.fullscreenElement === document.documentElement`) as boolean);
  // The way in: a navy iris closes on the Battle button while the Dojo eases back, a beat of navy, then the Shifu loop
  // opens from a growing circle in the middle (owner 2026-10-27). Sampled against the overlay's own clock.
  const waitAge = async (ms: number) => { const age = (await overlay(b))?.age ?? 0; if (ms - age > 0) await b.sleep(ms - age); return overlay(b); };
  const closing = await waitAge(500);
  await b.screenshot(`${OUT}/entry-iris-closing.png`);
  const closing2 = await waitAge(1000);
  ok('the iris closes on the pressed Battle button', !!closing && Math.abs(closing.irisX - button.x) <= 2 && Math.abs(closing.irisY - button.y) <= 2, closing ? `iris at ${closing.irisX},${closing.irisY}; button ${Math.round(button.x)},${Math.round(button.y)}` : 'no overlay');
  ok('the hole shrinks as it closes', !!closing && !!closing2 && closing.irisR !== null && closing2.irisR !== null && closing2.irisR < closing.irisR && closing.irisR > 0, `${closing?.irisR} px at ${closing?.age} ms → ${closing2?.irisR} px at ${closing2?.age} ms`);
  const sceneStill = await b.eval(`(() => { const st = document.querySelector('.dojo-stage'); return st ? getComputedStyle(st).getPropertyValue('--dojo-stage-scale') : null; })()`);
  ok('the Dojo scene holds still under the iris (no re-fit on the fullscreen resize)', sceneStill === null || sceneStill === stageBefore, `${stageBefore} → ${sceneStill}`);
  ok('the Dojo eases back under the iris', await b.eval(`(() => { const p = document.querySelector('#page-content[data-page="dojo"]'); return !p || parseFloat(getComputedStyle(p).scale) < 1; })()`) as boolean);
  const beat = await waitAge(IRIS_CLOSE_MS + NAVY_BEAT_MS / 2);
  await b.screenshot(`${OUT}/entry-iris-navy.png`);
  const opening = await waitAge(IRIS_CLOSE_MS + NAVY_BEAT_MS + IRIS_OPEN_MS / 2);
  await b.screenshot(`${OUT}/entry-iris-opening.png`);
  ok('Shifu opens from a circle in the middle', !!opening && opening.loopVisible && (opening.loopR ?? 0) > 0 && !opening.revealed, opening ? `circle ${opening.loopR} px at ${opening.age} ms` : 'no overlay');
  ok('the battle page waits until Shifu is fully open', !!opening && opening.path === '/dojo', opening ? `path ${opening.path} at ${opening.age} ms` : '');
  const mid = await waitAge(IRIS_CLOSE_MS + NAVY_BEAT_MS + IRIS_OPEN_MS + 400);
  ok('Shifu fully open ≈ 2.55 s after the press', !!mid && mid.revealed && mid.loopVisible, mid ? `revealed ${mid.revealed} at ${mid.age} ms` : 'no overlay');
  // The beat is short (0.25 s): measured from the overlay's own marks, not a lucky sample.
  const marks = await b.eval(`(() => { const o = document.querySelector('[data-testid=battle-entry]'); return o ? { closed: Number(o.dataset.closedAt), opened: Number(o.dataset.openedAt) } : null; })()`) as { closed: number; opened: number } | null;
  const gap = marks && marks.closed && marks.opened ? Math.round(marks.opened - marks.closed) : null;
  ok('a beat of navy between the iris shutting and Shifu opening', !!beat && beat.bg === NAVY && gap !== null && gap >= NAVY_BEAT_MS - 60, `${gap} ms of navy (${NAVY_BEAT_MS} ms planned), ${beat?.bg}`);
  const maxGap = await b.eval(`Number(document.querySelector('[data-testid=battle-entry]')?.dataset.maxFrameGap ?? NaN)`) as number;
  checks.push(`info longest frame while the iris moved: ${maxGap} ms (headless SwiftShader; a real GPU is smoother)`);
  ok('loop is animating (frame advances)', !!mid && mid.frame !== null && mid.frame !== '0', `frame ${mid?.frame}`);
  await b.screenshot(`${OUT}/entry-curtain.png`);
  // Probes run muted (cdp.ts writes the music prefs off) unless AUDIO=1: muted → the breeze must stay silent;
  // with audio → playing and fading in towards its gain (0.25 × the battle volume, 50% by default).
  const audioOn = !!process.env.AUDIO;
  const air = await breeze(b);
  if (audioOn) ok('breeze fades on the audio thread (routed through the shared context)', !!air && air.smooth, air ? `smooth ${air.smooth}` : 'no handle');
  const airDetail = !air ? 'no handle' : air.url === null ? 'no AMB_Loading_Breeze master yet — silent' : `${air.url.split('/').pop()} ${air.playing ? 'playing' : 'paused'}, volume ${air.volume?.toFixed(3)}`;
  ok(audioOn ? 'breeze playing with the loop at its fixed 35 % (audio on, battle music off — it follows the SFX switch)' : 'breeze silent while muted', !!air && (air.url === null || (audioOn ? air.playing && (air.volume ?? 1) <= 0.36 : !air.playing)), airDetail);
  await b.screenshot(`${OUT}/entry-loading.png`);
  // The arena's bed (owner 2026-10-25): with battle music on it starts with the breeze on the loading screen.
  const bed = () => b.eval(`(() => { const m = window.__clawbadaArenaMusic; return m && m.audio ? { src: m.audio.src.split('/').pop(), playing: !m.audio.paused, volume: m.level ?? m.audio.volume, smooth: !!m.smooth } : null; })()`) as Promise<{ src: string; playing: boolean; volume: number; smooth: boolean } | null>;
  let bedAtEntry: { src: string; playing: boolean; volume: number } | null = null;
  if (musicOn) {
    bedAtEntry = await bed();
    ok('Dojo track fades on the audio thread', !!bedAtEntry && bedAtEntry.smooth, `smooth ${bedAtEntry?.smooth}`);
    ok('Dojo track playing with the breeze on the loading screen', !!bedAtEntry && bedAtEntry.playing && /BGM_Arena_Dojo/.test(bedAtEntry.src), bedAtEntry ? `${bedAtEntry.src} ${bedAtEntry.playing ? 'playing' : 'paused'}, volume ${bedAtEntry.volume.toFixed(3)}` : 'no arena audio');
  }

  if (audioOn) {
    // Owner 2026-10-27: the wind and the Dojo music start at the press and rise together over 3 s.
    const ramps = b.allLogs.filter((l) => /\[AudioGraph\] \S+ ramp 0\.000 → [\d.]+ over 3000 ms/.test(l));
    ok('wind and music both fade in over 3 s', ramps.some((r) => /AMB_Loading_Breeze/.test(r)) && (!musicOn || ramps.some((r) => /BGM_Arena_Dojo/.test(r))), ramps.map((r) => r.replace(/.*\[AudioGraph\] /, '')).join(' | ') || 'no 3 s ramps logged');
  }
  const navigated = await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000);
  ok('navigated to the battle page under the overlay', navigated);
  if (!navigated) {
    // The start failed: the Dojo shows the error in its summary line and the sequence drops the overlay.
    console.log('dojo says:', await b.eval(`document.querySelector('[data-testid=dojo-gate]')?.textContent ?? Array.from(document.querySelectorAll('span')).map(s => s.textContent).find(t => /Could not|expired|failed|error/i.test(t || '')) ?? '(no error text)'`));
    console.log('next dev issues:', await b.eval(`(document.querySelector('nextjs-portal')?.shadowRoot?.textContent ?? '(none)').slice(0, 300)`));
    const telling = b.allLogs.filter((l) => /error|Error|Unhandled|failed|BattleEntry|EntryAmbience|Dojo\]/.test(l) && !/^\[net\]/.test(l));
    for (const l of (telling.length ? telling : b.allLogs).slice(-12)) console.log('console:', l.slice(0, 220));
  }
  // The overlay must still be up 0.3 s before the hold ends (the hold is 12 s from the loop, 0.7 s after the press) …
  const until5 = CURTAIN_MS + HOLD_MS - 300 - (Date.now() - t0);
  if (until5 > 0) await b.sleep(until5);
  const at5 = await overlay(b);
  ok('still covering 0.3 s before the hold ends', !!at5 && at5.phase === 'web', `phase ${at5?.phase}`);
  // … and gone once the hold has passed AND the arena was built (InitBattle), 400 ms fade included.
  const gone = await b.waitFor(`!document.querySelector('[data-testid=battle-entry]')`, 60000, 100);
  const tGone = Date.now() - t0;
  ok('overlay released after the hold + arena ready', gone, `${tGone} ms after the press`);
  ok('released no earlier than the curtain + the 12 s hold', tGone >= CURTAIN_MS + HOLD_MS, `${tGone} ms`);
  if (audioOn) {
    await b.sleep(1500);   // the breeze's 0.9 s fade-out, with margin
    const after = await breeze(b);
    ok('breeze faded out at the hand-over to Unity', !!after && (after.url === null || !after.playing), after ? `${after.playing ? 'playing' : 'paused'}, volume ${after.volume?.toFixed(3)}` : 'no handle');
  }

  // The Unity half (a player build with LoadingScreenController): the training scene reported itself, the web
  // loop handed over the tip, Unity held it ≥ 15 s from that moment, then released into the intro.
  const unityShown = b.allLogs.some((l) => /\[LoadingScreen\] training scene shown/.test(l));
  ok('unity training scene shown (player build with the loading scene)', unityShown);
  if (unityShown) {
    const tipAt = Date.now();
    const tipSet = await (async () => { while (Date.now() - tipAt < 15000) { if (b.allLogs.some((l) => /\[LoadingScreen\] tip set/.test(l))) return true; await b.sleep(200); } return false; })();
    ok('tip handed to Unity after the web loop lifted', tipSet);
    await b.sleep(1200);
    await b.screenshot(`${OUT}/entry-training.png`);
    const releasedAt = Date.now();
    const released = await (async () => { while (Date.now() - releasedAt < 45000) { const l = b.allLogs.find((x) => /\[LoadingScreen\] released after/.test(x)); if (l) return l; await b.sleep(200); } return null; })();
    const held = released ? Number((released.match(/after ([0-9.]+) s/) || [])[1]) : NaN;
    ok('unity released the training scene', !!released, released ? `${held} s on screen` : 'no release log');
    ok(`unity held the training scene ≥ ${UNITY_HOLD_S} s`, Number.isFinite(held) && held >= UNITY_HOLD_S, `${held} s`);
  }

  const live = await b.waitFor(`(() => { const s = document.querySelector('[data-testid=battle-status-line]'); return !!s && /Your turn|Bot thinking|Opponent/.test(s.textContent || ''); })()`, 180000, 500);
  ok('unity status line live', live);
  const t1 = Date.now();
  let introDone = false;
  while (Date.now() - t1 < 60000) { if (b.allLogs.some((l) => /intro\w* ?(complete|done|finished)|IntroComplete/i.test(l))) { introDone = true; break; } await b.sleep(500); }
  ok('intro completed', introDone);
  // Owner 2026-10-24: with the longer entry the 25 s intro watchdog fired before the intro ended, the bot's first turn landed
  // mid-intro and its walk could be cut off (rig stuck walking in place, footsteps looping). Unity must report the end itself.
  const introBy = b.allLogs.find((l) => /\[BattleStage\] intro complete \(/.test(l));
  // "(no intro)" means the server had already started the battle when Unity got it (START_WAIT_MS too short).
  if (musicOn) {
    const after = await bed();
    const carried = b.allLogs.some((l) => /carried on from the loading screen/.test(l));
    for (const l of b.allLogs.filter((x) => /\[ArenaMusic\]|\[BattleEntry\]|EntryAmbience\] (fade|playing)/.test(x))) console.log('  music:', l.slice(0, 200));
    ok('the same Dojo track carried on into the battle (no restart)', carried && !!after && after.playing && after.src === bedAtEntry?.src, `${after?.src ?? 'none'} ${after?.playing ? 'playing' : 'paused'}; ${carried ? 'adopted' : 'NOT adopted'}`);
  }
  ok('intro played and reported by Unity (not skipped, not the safety watchdog)', !!introBy && /\(unity\)/.test(introBy), introBy ?? 'no report');
  await b.sleep(introDone ? 2000 : 0);
  await b.screenshot(`${OUT}/entry-arena.png`);
  if (autoplay) {
    // A few opening turns, both sides walking: none may be released by the watchdog or cut off mid-walk.
    const tTurns = Date.now();
    const played = () => b.allLogs.filter((l) => /\[BattleBridge\] PlayTurn|\[BattleManager\] PlayTurn/.test(l)).length;
    while (Date.now() - tTurns < 60000 && played() < 4) await b.sleep(500);
    await b.sleep(4000);   // let the last of them finish
    const walks = b.allLogs.filter((l) => /\[LobsterController\] move \w+ [1-9]/.test(l)).length;
    const cut = b.allLogs.filter((l) => /cut short|releasing the HUD/.test(l));
    ok('opening turns played after the intro', played() >= 4, `${played()} turns, ${walks} walks`);
    ok('no walk cut off, no turn released by the watchdog', cut.length === 0, cut.slice(0, 2).join(' | '));
  }

  if (process.env.AUDIO) for (const l of b.allLogs.filter((x) => /\[AudioGraph\]|\[EntryAmbience\]/.test(x)).slice(0, 20)) console.log('  audio:', l.slice(0, 170));
  for (const c of checks) console.log(c);
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails === 0 ? '[entry] all ok' : `[entry] ${fails} FAIL`);
}
