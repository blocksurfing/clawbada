import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const TAG = process.env.TAG ?? 'shell';
/** Web origin under test (a worktree's dev server can run on another port). */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

async function rect(b: Browser, selector: string, text?: string) {
  return b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, w: q.width, h: q.height }; })()`);
}
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await rect(b, selector, text);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
async function key(b: Browser, k: string, code: string, vk: number) {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, '').split('\n')[0]);
const shot = async (b: Browser, name: string) => { await b.screenshot(`${S}/${TAG}-${name}.png`); };

/** Nzib's Shell (2026-10-11) on /game: the room fills the viewport with his proportional cover (all seven layers
 *  identical: zoom = max(w/640, h/360), centred, bottom-aligned, z 0..6), the shark swims behind the art and the
 *  bubbles stream; the three stages open the picker (dev sample classes on a wallet with no lobsters), a pick
 *  plays the beam in and shows the character, Battle enables and its press opens the modal with the wooden
 *  panel painted, three stake brackets with amounts and Find Match disabled with the reason; Escape returns
 *  focus to Battle; Queue/Active/History slide in 220 ms, only one open, inert when closed, Escape restores
 *  focus, the lineup survives; /game?battle=1 opens the modal; the compact sidebar sits beside it. Frames
 *  `out/shell-*.png`. Fails on any step or runtime error. */
export default async function (b: Browser) {
  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[shell-fail] ${msg}`); };
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.send('Network.clearBrowserCache', {});
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await b.goto(`${BASE}/game`);
  const roomUp = await b.waitFor(`!!document.querySelector('.shell-room') && !!document.querySelector('.shell-room').style.getPropertyValue('--stage-unit') && !document.querySelector('#toggle')?.disabled`, 30000, 100);
  if (!roomUp) fail('the Shell room did not mount (no --stage-unit) or the sidebar never finished its opening roll');
  await b.sleep(800);

  // 1. Geometry: the room is the viewport; every layer shares the cover maths.
  const geo = await b.eval(`(() => {
    const room = document.querySelector('.shell-room'); const r = room.getBoundingClientRect();
    const layers = [...document.querySelectorAll('.shell-art-layer')].map(el => { const s = getComputedStyle(el); return { key: el.dataset.shellLayer, z: Number(s.zIndex), size: s.backgroundSize, pos: s.backgroundPosition, img: s.backgroundImage.includes('/ui/shell/'), render: s.imageRendering }; });
    const shark = document.querySelector('.shell-shark');
    return { room: { x: r.x, y: r.y, w: r.width, h: r.height }, layers, scrollY: window.scrollY, docH: document.documentElement.scrollHeight, inner: innerHeight,
      shark: shark ? { first: shark.parentElement.firstElementChild === shark, z: getComputedStyle(shark).zIndex, anim: shark.getAnimations().length } : null,
      bubbles: document.querySelectorAll('.shell-bubble').length, seaweed: [...document.querySelectorAll('.shell-seaweed')].every(e => getComputedStyle(e).backgroundImage.includes('seaweed')),
      stages: document.querySelectorAll('.lobby-slot').length, beams: document.querySelectorAll('.shell-room > .stage-lighting').length,
      sidebarW: getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim(), compact: document.body.classList.contains('sidebar-compact') };
  })()`);
  if (!(geo.room.x === 0 && geo.room.y === 0 && geo.room.w === 1600 && geo.room.h === 1000)) fail(`room rect ${JSON.stringify(geo.room)} is not the viewport`);
  if (geo.docH > geo.inner + 1 || geo.scrollY !== 0) fail(`the page scrolls (doc ${geo.docH} > ${geo.inner})`);
  const expectedOrder = ['background-rock-2', 'background-rock', 'coral', 'back-sand', 'shell', 'sand', 'rock'];
  const order = geo.layers.map((l: { key: string }) => l.key);
  if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) fail(`layer order ${order.join(',')}`);
  geo.layers.forEach((l: { key: string; z: number; img: boolean; render: string }, i: number) => { if (l.z !== i || !l.img || l.render !== 'pixelated') fail(`layer ${l.key}: z ${l.z} img ${l.img} ${l.render}`); });
  const sizes = new Set(geo.layers.map((l: { size: string; pos: string }) => `${l.size}|${l.pos}`));
  if (sizes.size !== 1) fail(`layers differ in cover sizing: ${[...sizes].join(' / ')}`);
  const [sw, sh] = geo.layers[0].size.split(' ').map(parseFloat), [px, py] = geo.layers[0].pos.split(' ').map(parseFloat);
  const zoom = Math.max(1600 / 640, 1000 / 360);
  if (Math.abs(sw / 640 - zoom) > 0.001 || Math.abs(sh - 360 * zoom) > 0.1) fail(`cover zoom ${sw / 640} ≠ ${zoom}`);
  if (Math.abs(px + sw / 2 - 800) > 0.1 || Math.abs(py + sh - 1000) > 0.1) fail(`art not centred/bottom-aligned (pos ${px},${py} size ${sw}×${sh})`);
  if (!geo.shark || !geo.shark.first || geo.shark.z !== '0') fail(`shark ${JSON.stringify(geo.shark)}`);
  if (geo.stages !== 3 || geo.beams !== 3) fail(`${geo.stages} stages / ${geo.beams} beams`);
  if (!geo.seaweed) fail('seaweed sheets not applied');
  if (!geo.compact || geo.sidebarW !== '288px') fail(`sidebar should start compact beside the Shell (compact ${geo.compact}, width ${geo.sidebarW})`);
  await b.sleep(1500);
  const bubbles = await b.eval(`document.querySelectorAll('.shell-bubble').length`);
  if (bubbles < 1) fail('no bubbles after 2 s');
  console.log('[shell-log]', `room ${geo.room.w}×${geo.room.h}, zoom ${(sw / 640).toFixed(3)}, art ${sw}×${sh} at ${px},${py}; shark ${geo.shark?.anim} anim; bubbles ${bubbles}; sidebar ${geo.sidebarW} compact=${geo.compact}`);
  await shot(b, 'room');

  // 2. The stage hit shape, the picker (dev samples: the burner owns nothing), a pick, the beam, the character.
  const battleDisabled = await b.eval(`document.querySelector('.shell-battle').disabled`);
  if (battleDisabled !== true) fail('Battle is enabled with an empty lineup');
  const tabTop = await b.eval(`(() => { const q = document.querySelector('[data-shell-tab="queue"]').getBoundingClientRect(); const el = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return el === document.querySelector('[data-shell-tab="queue"]') ? 'queue' : (el ? el.textContent.trim().slice(0, 24) : 'none'); })()`);
  if (tabTop !== 'queue') fail(`something covers the Queue button: "${tabTop}"`);
  await rectClick(b, 'button', 'burner wallet').catch(() => fail('no "burner wallet" chip'));
  await b.sleep(600);
  const hit = await b.eval(`(() => { const s = document.querySelectorAll('.character-stage')[0]; const r = s.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el === s || s.contains(el) ? 'stage' : (el ? el.className : 'none'); })()`);
  if (hit !== 'stage') fail(`stage 1 centre is covered by ${hit}`);
  await rectClick(b, '.character-stage');
  const pickerOpen = await b.waitFor(`document.querySelector('.lobster-picker')?.open === true`, 3000, 50);
  if (!pickerOpen) fail('the picker did not open from the stage');
  const optionCount = await b.eval(`document.querySelectorAll('.picker-options button').length`);
  if (optionCount < 1) fail('the picker has no options (dev samples expected on an empty wallet)');
  await shot(b, 'picker');
  await rectClick(b, '.picker-options button', 'Mantis');
  const lit = await b.waitFor(`document.querySelector('.shell-room > .stage-lighting[data-slot="0"]')?.dataset.phase === 'on'`, 4000, 50);
  if (!lit) fail('the beam did not play in after the pick');
  const name0 = await b.eval(`document.querySelectorAll('.slot-name')[0].textContent.trim()`);
  if (name0 !== 'Mantis') fail(`slot 1 shows "${name0}"`);
  const charShown = await b.eval(`(() => { const c = document.querySelector('.lobby-slot[data-slot="0"] .slot-character'); return c && !c.hidden && c.getBoundingClientRect().height > 0; })()`);
  if (!charShown) fail('the character is not shown on stage 1');
  const battleEnabled = await b.eval(`!document.querySelector('.shell-battle').disabled`);
  if (!battleEnabled) fail('Battle stayed disabled after a pick');
  await rectClick(b, '.lobby-slot[data-slot="2"] .character-stage');
  await b.waitFor(`document.querySelector('.lobster-picker')?.open === true`, 3000, 50);
  const mantisDisabled = await b.eval(`document.querySelector('.picker-options button[data-class="Mantis"]')?.disabled`);
  if (mantisDisabled !== true) fail('a lobster already on a stage is still offered');
  await rectClick(b, '.picker-options button', 'Ember');
  await b.waitFor(`document.querySelector('.shell-room > .stage-lighting[data-slot="2"]')?.dataset.phase === 'on'`, 4000, 50);
  await b.sleep(500);
  await shot(b, 'selected');

  // 3. Battle: press animation, the modal, the wooden panel, the brackets, the reason, Escape → focus back.
  await rectClick(b, '.shell-battle');
  const modalOpen = await b.waitFor(`document.querySelector('.battle-modal')?.open === true`, 3000, 50);
  if (!modalOpen) fail('the Battle modal did not open');
  // The slide-up is a 280 ms Web Animation that this headless Chrome starts late (see the panel note below), and the
  // wooden panel paints once its image has decoded — wait for both instead of a fixed delay.
  const modalSettled = await b.waitFor(`(() => { const m = document.querySelector('.battle-modal'); return !!m && m.getAnimations().length === 0 && m.querySelector('[data-pixel-panel]')?.dataset.pixelReady === 'true'; })()`, 6000, 50);
  if (!modalSettled) fail('the Battle modal never settled (slide still running or the wooden panel unpainted)');
  const modal = await b.eval(`(() => { const m = document.querySelector('.battle-modal'); const r = m.getBoundingClientRect(); const panel = m.querySelector('[data-pixel-panel]'); const sel = m.querySelector('#battle-bracket'); const fm = [...m.querySelectorAll('button')].find(x => x.textContent.trim() === 'Find Match'); return { inView: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, panelReady: panel?.dataset.pixelReady, options: sel ? [...sel.options].map(o => o.textContent) : [], fmDisabled: fm?.disabled, reason: m.querySelector('#battle-unavailable')?.textContent.trim(), practice: /Practice/.test(m.innerText), hasPicker: !!m.querySelector('.lobby-slot,.lobster-picker') }; })()`);
  if (!modal.inView) fail('the modal is outside the viewport');
  if (modal.panelReady !== 'true') fail('the wooden panel is not painted');
  if (modal.options.length !== 3) fail(`bracket options: ${JSON.stringify(modal.options)}`);
  // The amounts come from GET /api/game/combat/stakes — a dev stack without contracts has no quote, so they are optional here.
  console.log('[shell-log]', `stake amounts quoted: ${modal.options.every((o: string) => /\$GOLD/.test(o))}`);
  if (modal.fmDisabled !== true) fail('Find Match is enabled for sample classes');
  if (!/Sample classes cannot queue|Pick three/.test(modal.reason ?? '')) fail(`reason: "${modal.reason}"`);
  if (modal.practice || modal.hasPicker) fail('the modal carries a Practice tab or a lineup picker');
  console.log('[shell-log]', `modal: ${modal.options.join(' | ')} — ${modal.reason}`);
  await shot(b, 'battle-modal');
  await key(b, 'Escape', 'Escape', 27);
  const modalClosed = await b.waitFor(`document.querySelector('.battle-modal')?.open === false`, 5000, 50);
  if (!modalClosed) fail('Escape did not close the modal');
  const focusBack = await b.eval(`document.activeElement?.className === 'shell-battle'`);
  if (!focusBack) fail('focus did not return to the Battle button');
  const kept = await b.eval(`[...document.querySelectorAll('.slot-name')].map(e => e.textContent.trim()).join(',')`);
  if (kept !== 'Mantis,Choose Lobster,Ember') fail(`the lineup changed under the modal: ${kept}`);

  // 4. Overlays: 220 ms slides, one open at a time, inert when closed, Escape → opener, lineup and Battle untouched.
  for (const view of ['queue', 'active', 'history']) {
    const motion = await b.eval(`(() => { const button = document.querySelector('[data-shell-tab="${view}"]'); button.click(); const panel = document.getElementById(button.getAttribute('aria-controls')); const a = panel.getAnimations()[0]; return { duration: a?.effect.getTiming().duration, frames: a?.effect.getKeyframes().map(f => f.transform), inert: panel.inert, expanded: button.getAttribute('aria-expanded') }; })()`);
    if (motion.duration !== 220 || JSON.stringify(motion.frames) !== JSON.stringify(['translateX(48px)', 'translateX(0px)']) || motion.inert || motion.expanded !== 'true') fail(`${view} open motion ${JSON.stringify(motion)}`);
    // Headless Chrome (software GL) holds a fresh Web Animation "pending" for a few hundred ms before its clock
    // starts, so wait for every panel's motion to settle rather than a fixed delay (his tests do the same).
    const settled = await b.waitFor(`[...document.querySelectorAll('.shell-records')].every(p => p.getAnimations().length === 0)`, 4000, 50);
    if (!settled) fail(`${view}: panel motions never settled`);
    const state = await b.eval(`(() => { const open = [...document.querySelectorAll('.shell-records')].filter(p => !p.hidden).map(p => p.id); const p = document.getElementById('shell-${view}'); const r = p.getBoundingClientRect(); return { open, inView: r.x >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, text: p.innerText.slice(0, 60), battle: !!document.querySelector('.shell-battle').offsetParent, lineup: [...document.querySelectorAll('.slot-name')].map(e => e.textContent.trim()).join(',') }; })()`);
    if (state.open.length !== 1 || state.open[0] !== `shell-${view}`) fail(`${view}: open panels ${state.open.join(',')}`);
    if (!state.inView) fail(`${view} panel is outside the viewport`);
    if (state.lineup !== 'Mantis,Choose Lobster,Ember') fail(`${view}: lineup changed to ${state.lineup}`);
    console.log('[shell-log]', `${view}: "${state.text.replace(/\n/g, ' · ')}"`);
    if (view === 'queue') await shot(b, 'queue');
  }
  await key(b, 'Escape', 'Escape', 27);
  const afterEsc = await b.waitFor(`document.getElementById('shell-history').hidden === true && document.activeElement === document.querySelector('[data-shell-tab="history"]')`, 4000, 50);
  if (!afterEsc) fail('Escape did not close the history panel with focus on its opener');
  const closedInert = await b.eval(`[...document.querySelectorAll('.shell-records')].every(p => p.inert && p.hidden)`);
  if (!closedInert) fail('closed panels are not inert + hidden');

  // 5. The legacy Battle URL opens the modal on the Shell and cleans the address.
  await b.goto(`${BASE}/game?battle=1`);
  const legacy = await b.waitFor(`document.querySelector('.battle-modal')?.open === true`, 20000, 100);
  if (!legacy) fail('/game?battle=1 did not open the Battle modal');
  const cleaned = await b.eval(`location.pathname + location.search`);
  if (cleaned !== '/game') fail(`URL after the legacy open is ${cleaned}`);
  await key(b, 'Escape', 'Escape', 27);
  await b.sleep(400);
  await shot(b, 'legacy-closed');

  // 6. Short laptop viewport: still the viewport, lineup on screen.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 760, deviceScaleFactor: 1, mobile: false });
  await b.sleep(600);
  const small = await b.eval(`(() => { const r = document.querySelector('.shell-room').getBoundingClientRect(); const bad = [...document.querySelectorAll('.lobby-slot,.character-stage,.slot-name,.shell-battle,.shell-tabs')].filter(el => { const q = el.getBoundingClientRect(); return q.bottom > innerHeight + 1 || q.top < 0 || q.right > innerWidth + 1 || q.left < 0; }).map(el => el.className); return { w: r.width, h: r.height, bad }; })()`);
  if (small.w !== 1440 || small.h !== 760 || small.bad.length) fail(`1440×760: room ${small.w}×${small.h}, out of view: ${small.bad.join(',')}`);
  await shot(b, 'short');
  await b.send('Emulation.clearDeviceMetricsOverride', {});

  const errs = grab(b, /^\[(error|exception)\]|^\[log:error\]|Uncaught|Exception/).filter((l) => !/eth\.merkle\.io|CORS|Failed to load resource|hydrat|Aave|Family|render\/sprite/i.test(l));
  if (errs.length) fail(`${errs.length} runtime errors`);
  for (const e of errs.slice(0, 6)) console.log('[shell-err]', e.slice(0, 220));
  console.log(`[shell] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/${TAG}-{room,picker,selected,battle-modal,queue,legacy-closed,short}.png`);
}
