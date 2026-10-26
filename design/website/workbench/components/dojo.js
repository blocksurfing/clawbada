import { pixelAssets } from '../pixel-assets.js';
import { createDemoRoom, parseDemoRoom, demoRoomLink } from './dojo-friend.js';
// Local design fixtures only. No wallet, API, or battle-engine integration.
export const dojoClasses = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
export const dojoBots = [
  { id: 'balanced', label: 'Balanced', difficulty: 'medium', behavior: 'Trades evenly, holds the middle, uses Specials as soon as they are charged.', lesson: 'Positioning beats raw damage.' },
  { id: 'aggressive', label: 'Aggressive', difficulty: 'medium', behavior: 'Goes for the most damage and the kill, even at a risk.', lesson: 'Punish it when it overextends.' },
  { id: 'charger', label: 'Charger', difficulty: 'easy', behavior: 'Defends to bank charge, then unloads its Specials.', lesson: 'Hit it hard while it turtles, before the Specials come.' },
  { id: 'greedy', label: 'Greedy', difficulty: 'easy', behavior: 'Walks straight at you and hits the weakest lobster it can reach.', lesson: 'A first opponent: learn the controls and the board.' },
  { id: 'cautious', label: 'Cautious', difficulty: 'easy', behavior: 'Keeps its distance and avoids getting hit.', lesson: 'Close the gap and pin down a kiter.' },
  { id: 'roles', label: 'Roles', difficulty: 'medium', behavior: 'Plays each class to its job: ranged kite at two hexes, melee brawls, tanks body-block, Sentinel shadows the wounded.', lesson: 'Positioning, and what each class is for.' },
  { id: 'focus', label: 'Focus', difficulty: 'hard', behavior: 'All three pile onto one of your lobsters until it drops.', lesson: 'Protect the target (Defend it, Fortify, heal it with Rally) and punish the pile-on.' },
  { id: 'deep', label: 'Deep', difficulty: 'hard', behavior: 'Looks two moves ahead, gangs up on one of your lobsters and covers its own weakest. The strongest bot.', lesson: 'Everything at once: think a turn ahead, focus your damage, protect your weak link.' },
];
const previewClasses = ['Mantis', 'Kraken', 'Ember', 'Bulwark', 'Abyss', 'Sentinel', 'Leviathan', 'Tempest', 'Specter', 'Reaver'];
const owned = Array.from({length:30}, (_,i) => ({id:String(101+i), name:previewClasses[i % previewClasses.length]}));
const teams = [{ id: '12', names: ['101', '102', '103'] }, { id: '18', names: ['104', '105', '106'] }];
const storageKey = 'clawbada-dojo-preview';
export function purityDescription(purity) {
  return `Specials hit ${100 + Number(purity) * 10}% as hard and fire their enhanced version ${5 + Number(purity) * 5}% of the time.`;
}
export function dojoSummary(state) {
  const team = state.mode === 'owned' && state.saved ? `Team #${state.saved}` : state.names.join(' / ');
  const arena = state.arena === 'Match team' ? state.tier : state.arena;
  return `${team} vs ${state.bot} bot · ${state.opponent === 'Mirror mine' ? 'mirror roster' : 'random classes'} · ${arena} arena`;
}
export function mountDojo(root) {
  if (root.dataset.page !== 'dojo') return () => {};
  const $ = selector => root.querySelector(selector);
  const headings = $('.dojo-team-headings');
  root.prepend(headings);
  $('.dojo-vs').src = new URL('../../site/The Dojo/VS.png', import.meta.url).href;
  const scenario = new URLSearchParams(location.search).get('dojoState');
  const shortScreen = matchMedia('(max-height: 699px), (min-width: 700px)');
  const fitGuide = () => { $('.dojo-guide').open = false; };
  fitGuide();
  shortScreen.addEventListener('change', fitGuide);
  const state = { mode: 'owned', saved: '12', ids: [...teams[0].names], names: [], builder: ['Kraken', 'Ember', 'Abyss'], tier: 'Apex', purity: '6', bot: 'Balanced', opponent: 'Mirror mine', arena: 'Match team' };
  let connected = scenario !== 'disconnected';
  let inventoryPage = 0;
  let pageSize = 1;
  let busy = false;
  let opponentMode = 'bot';
  let roomCode = '';
  let roomJoined = false;
  const mobileRoom = matchMedia('(max-width:699px)');
  const fitRoom = () => { if (!mobileRoom.matches) $('[data-room-options]').open = true; };
  mobileRoom.addEventListener('change', fitRoom);
  let timer;
  let running = null;
  try { running = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Storage may be unavailable. */ }
  if (typeof running !== 'string') running = null;
  if (scenario === 'running') running = 'Team #12 vs Balanced bot · mirror roster · Evolved arena';
  const save = () => { try { if (running) sessionStorage.setItem(storageKey, JSON.stringify(running)); else sessionStorage.removeItem(storageKey); } catch { /* Preview remains usable without storage. */ } };
  const option = (value, label) => `<option value="${value}">${label}</option>`;
  $('[data-saved-team]').innerHTML = option('', 'Choose individually') + teams.map(team => option(team.id, `Team #${team.id} · ${team.names.map(id => owned.find(item => item.id === id).name).join(' / ')} · Evolved`)).join('');
  $('[data-owned-inventory]').innerHTML = owned.map(item => `<button type="button" class="dojo-inventory-tile" data-owned-id="${item.id}" aria-pressed="false"><i class="dojo-portrait-clip" aria-hidden="true"><canvas width="64" height="64" data-inventory-class="${item.name}" aria-hidden="true"></canvas></i><span title="${item.name} #${item.id}" aria-label="${item.name} #${item.id}">${item.name}</span><span data-slot-badge hidden aria-hidden="true"></span><i class="dojo-selected-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></i></button>`).join('');
  const pager = document.createElement('div');
  pager.className = 'dojo-inventory-pager';
  pager.innerHTML = '<button type="button" data-inventory-prev aria-label="Previous lobsters">‹</button><span data-inventory-page></span><button type="button" data-inventory-next aria-label="Next lobsters">›</button>';
  $('[data-owned-inventory]').after(pager);
  function paginateInventory() {
    pageSize = 10;
    const portraitSize = Math.max(0, ($('[data-owned-inventory]').clientWidth - 36) / 5);
    $('[data-owned-inventory]').style.setProperty('--portrait-size', `${portraitSize}px`);
    const pages = Math.ceil(owned.length / pageSize);
    inventoryPage = Math.min(inventoryPage, pages - 1);
    root.querySelectorAll('[data-owned-id]').forEach((tile, i) => { tile.hidden = Math.floor(i / pageSize) !== inventoryPage; });
    $('[data-owned-inventory]').style.gridTemplateColumns = 'repeat(5, var(--portrait-size))';
    $('[data-inventory-page]').textContent = `${inventoryPage + 1} / ${pages}`;
    $('[data-inventory-prev]').disabled = inventoryPage === 0;
    $('[data-inventory-next]').disabled = inventoryPage === pages - 1;
  }
  const inventoryObserver = new ResizeObserver(paginateInventory);
  inventoryObserver.observe($('[data-owned-inventory]'));
  const shadow = new URL('../../../../packages/battle-engine/ClawbadaBattle/Assets/Art/Characters/Shared/Character_Shadow.png', import.meta.url).href;
  root.querySelectorAll('[data-lineup]').forEach(lineup => {
    lineup.innerHTML = [0,1,2].map(i => `<figure class="dojo-fighter" data-fighter="${lineup.dataset.lineup}" data-slot="${i}"><img class="dojo-shadow" src="${shadow}" width="64" height="32" alt=""><canvas role="img"></canvas></figure>`).join('');
  });
  $('[data-builder-slots]').innerHTML = [0, 1, 2].map(i => `<label class="dojo-field">Slot ${i + 1}<select data-builder-slot="${i}" aria-label="Class slot ${i + 1}">${dojoClasses.map(name => option(name, name)).join('')}</select></label>`).join('');
  $('[data-bot]').innerHTML = dojoBots.map(bot => option(bot.label, `${bot.label} · ${bot.difficulty}`)).join('');
  const choices = { tier: ['Evolved', 'Elite', 'Apex'], purity: ['0', '1', '2', '3', '4', '5', '6'], opponent: ['Mirror mine', 'Random classes'], arena: ['Match team', 'Evolved', 'Elite', 'Apex'] };
  Object.entries(choices).forEach(([key, values]) => {
    $(`[data-choices="${key}"]`).innerHTML = values.map(value => `<button type="button" class="dojo-choice" data-choice="${key}" data-value="${value}" aria-pressed="false">${value}</button>`).join('');
  });
  const empty = scenario === 'empty';
  const summary = () => opponentMode === 'friend' ? `Local demo room ${roomCode} · simulated join · demo opponent only · not multiplayer` : dojoSummary({ ...state, tier: state.mode === 'owned' ? 'Evolved' : state.tier, names: state.mode === 'owned' ? state.ids.map(id => owned.find(item => item.id === id)?.name || 'Empty slot') : state.builder });
  const valid = () => state.mode === 'builder' || (!empty && state.ids.filter(Boolean).length === 3 && new Set(state.ids).size === 3);
  // Trim transparent gutters only; inventory uses --pixel, selected lineups use their approved scale.
  const atlas = new Image();
  const fighters = [...root.querySelectorAll('[data-fighter]')];
  function drawClass(canvas, name, pixelToken = '--pixel') {
      const scale = parseFloat(getComputedStyle(root).getPropertyValue(pixelToken));
      const frame = document.createElement('canvas');
      frame.width = frame.height = 64;
      const ctx = frame.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(atlas, dojoClasses.indexOf(name) * 64, 0, 64, 64, 0, 0, 64, 64);
      const pixels = ctx.getImageData(0, 0, 64, 64).data;
      let left = 64, top = 64, right = 0, bottom = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        if (!pixels[(y * 64 + x) * 4 + 3]) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
      canvas.width = right - left; canvas.height = bottom - top;
      canvas.style.width = `${canvas.width * scale}px`; canvas.style.height = `${canvas.height * scale}px`;
      canvas.getContext('2d').drawImage(frame, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      return { left, right, bottom, scale };
  }
  function renderFighters() {
    if (!atlas.complete || !atlas.naturalWidth) return;
    const names = state.mode === 'builder' ? state.builder : empty ? ['', '', ''] : state.ids.map(id => owned.find(item => item.id === id)?.name);
    fighters.forEach(figure => {
      const friendOpponent = figure.dataset.fighter === 'opponent' && opponentMode === 'friend';
      const sample = figure.dataset.fighter === 'opponent' && (friendOpponent || state.opponent !== 'Mirror mine');
      const slot = Number(figure.dataset.slot);
      const name = friendOpponent && !roomJoined ? null : sample ? ['Kraken', 'Bulwark', 'Tempest'][slot] : names[slot];
      const canvas = figure.querySelector('canvas');
      canvas.hidden = !name;
      figure.querySelector('img').hidden = !name;
      if (!name) { delete canvas.dataset.class; canvas.removeAttribute('aria-label'); return; }
      const crop = drawClass(canvas, name, '--dojo-selected-pixel');
      // Preserve the authored 64px frame around its common floor anchor (32,44).
      // Cropping transparent gutters must not turn claw/flame bounds into a pivot.
      const left = figure.dataset.fighter === 'team' ? 32 - crop.right : crop.left - 32;
      canvas.style.left = `calc(50% + ${left * crop.scale}px)`;
      canvas.style.bottom = `calc(16 * var(--dojo-selected-pixel) + ${(44 - crop.bottom) * crop.scale}px)`;
      canvas.setAttribute('aria-label', `${name}, slot ${slot + 1}${sample ? ', local sample opponent' : ''} class artwork`);
      canvas.dataset.class = name;

    });

  }
  function renderInventory() {
    root.querySelectorAll('[data-inventory-class]').forEach(canvas => {
      drawClass(canvas, canvas.dataset.inventoryClass);
    });
  }
  atlas.onload = () => { renderFighters(); renderInventory(); };
  atlas.src = pixelAssets.apexClassSheet.src;
  const fighterObserver = new ResizeObserver(renderFighters);
  fighters.forEach(figure => fighterObserver.observe(figure));
  function update() {
    $('.dojo').dataset.opponentView = opponentMode;
    $('.dojo').dataset.roomJoined = String(roomJoined);
    root.querySelectorAll('[data-opponent-mode]').forEach(tab => { const selected = tab.dataset.opponentMode === opponentMode; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
    $('#dojo-bot').hidden = opponentMode !== 'bot';
    $('#dojo-friend').hidden = opponentMode !== 'friend';
    $('[data-lineup="opponent"]').setAttribute('aria-label', opponentMode === 'friend' ? 'Local demo opponent only, not another player' : 'Opponent selected three lobsters');
    renderFighters();
    root.querySelectorAll('[data-team-mode]').forEach(tab => { const selected = tab.dataset.teamMode === state.mode; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
    $('#dojo-owned').hidden = state.mode !== 'owned';
    $('#dojo-builder').hidden = state.mode !== 'builder';
    $('[data-owned-controls]').hidden = empty;
    $('[data-empty-message]').hidden = !empty;
    $('[data-saved-team]').value = state.saved;
    root.querySelectorAll('[data-owned-id]').forEach(button => {
      const slot = state.ids.indexOf(button.dataset.ownedId);
      button.setAttribute('aria-pressed', String(slot >= 0));
      const badge = button.querySelector('[data-slot-badge]');
      badge.hidden = slot < 0;
      badge.textContent = slot >= 0 ? String(slot + 1) : '';
      const item = owned.find(item => item.id === button.dataset.ownedId);
      button.setAttribute('aria-label', `${item.name} #${item.id}${slot >= 0 ? `, slot ${slot + 1}, click to remove` : ', click to add'}`);
    });
    root.querySelectorAll('[data-builder-slot]').forEach(select => { select.value = state.builder[Number(select.dataset.builderSlot)]; });
    root.querySelectorAll('[data-choice]').forEach(button => button.setAttribute('aria-pressed', String(state[button.dataset.choice] === button.dataset.value)));
    $('[data-purity-description]').textContent = purityDescription(state.purity);
    $('[data-choices="purity"]').closest('fieldset').title = purityDescription(state.purity);
    const bot = dojoBots.find(item => item.label === state.bot);
    $('[data-bot-behavior]').textContent = bot.behavior;
    $('[data-bot-lesson]').textContent = bot.lesson;
    $('[data-train]').dataset.running = String(Boolean(running));
    $('[data-train]').disabled = busy || (connected && !valid()) || (opponentMode === 'friend' && (!roomJoined || !valid()));
    $('[data-train]').setAttribute('aria-busy', String(busy));
    const battleLabel = busy ? 'Starting…' : !connected ? 'Connect preview' : running ? 'Resume' : 'Battle';
    $('[data-train]').setAttribute('aria-label', battleLabel);
    $('[data-train]').title = battleLabel;
    if (!connected) $('[data-dojo-status]').textContent = 'Connect your wallet to train. This preview only simulates a connection.';
  }
  function preview() {
    $('[data-preview-summary]').textContent = running;
    $('.dojo-dialog').showModal();
  }
  function setRoom(code, joined) {
    roomCode = code;
    roomJoined = joined;
    $('[data-room-options]').open = !joined || !mobileRoom.matches;
    $('[data-room-details]').hidden = false;
    $('[data-room-code]').textContent = code;
    $('[data-room-link]').value = demoRoomLink(code, location.href);
    $('[data-room-status]').textContent = joined ? 'Simulated join. Demo opponent only — no player connected.' : 'Waiting for friend — demo only.';
    $('[data-share-status]').textContent = '';
    $('[data-join-error]').textContent = '';
    $('[data-join-input]').setAttribute('aria-invalid', 'false');
    update();
  }
  function joinRoom(event) {
    event.preventDefault();
    const code = parseDemoRoom($('[data-join-input]').value, location.href);
    $('[data-join-input]').setAttribute('aria-invalid', String(!code));
    if (!code) { $('[data-join-error]').textContent = 'Use a DEMO code or local room link.'; return; }
    setRoom(code, true);
  }
  async function copyRoom() {
    const input = $('[data-room-link]');
    const status = $('[data-share-status]');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(input.value);
      status.textContent = 'Demo link copied.';
    } catch {
      const focus = document.activeElement;
      input.focus(); input.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Keep the link selected for manual copying. */ }
      status.textContent = copied ? 'Demo link copied.' : 'Copy unavailable — select and copy the link above.';
      if (copied) focus?.focus();
    }
  }
  async function shareRoom() {
    if (!navigator.share) { await copyRoom(); return; }
    try {
      await navigator.share({ title: 'Clawbada Dojo local demo', text: 'Local UI demo only — not multiplayer. This link opens a simulated room, not a player connection.', url: $('[data-room-link]').value });
      $('[data-share-status]').textContent = 'Demo link shared.';
    } catch (error) {
      if (error.name === 'AbortError') { $('[data-share-status]').textContent = 'Share cancelled.'; return; }
      await copyRoom();
    }
  }
  // Pointer capture keeps mouse, pen and touch drags alive outside the source.
  const teamFighters = fighters.filter(figure => figure.dataset.fighter === 'team');
  let drag = null;
  let suppressClick = false;
  function clearPreview() {
    root.querySelectorAll('[data-drag-preview]').forEach(ghost => ghost.remove());
  }
  function targetSlot(x, y) {
    // Use the existing diagonal slot boxes, not overlapping transparent art.
    return teamFighters.findIndex(figure => {
      const box = figure.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    });
  }
  function overInventory(x, y) {
    const box = $('[data-owned-inventory]').getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }
  function showDragPreview(slot) {
    clearPreview();
    if (slot < 0 || !atlas.naturalWidth) return;
    const ghost = document.createElement('div');
    ghost.dataset.dragPreview = '';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = `<img class="dojo-shadow" src="${shadow}" alt="" draggable="false"><canvas></canvas>`;
    const canvas = ghost.querySelector('canvas');
    const name = owned.find(item => item.id === drag.id).name;
    const crop = drawClass(canvas, name, '--dojo-selected-pixel');
    canvas.dataset.class = name;
    canvas.style.left = `calc(50% + ${(32 - crop.right) * crop.scale}px)`;
    canvas.style.bottom = `calc(16 * var(--dojo-selected-pixel) + ${(44 - crop.bottom) * crop.scale}px)`;
    teamFighters[slot].append(ghost);
  }
  function pointerdown(event) {
    suppressClick = false;
    if (drag || event.button !== 0 || !event.isPrimary || state.mode !== 'owned' || empty) return;
    const source = event.target.closest('[data-owned-id], [data-fighter="team"]');
    if (!source) return;
    const id = source.dataset.ownedId || state.ids[Number(source.dataset.slot)];
    if (!id) return;
    drag = { id, source, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, slot: -1 };
    source.setPointerCapture(event.pointerId);
  }
  function pointermove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.active) {
      const follower = document.createElement('canvas');
      follower.dataset.dragFollower = '';
      follower.setAttribute('aria-hidden', 'true');
      drawClass(follower, owned.find(item => item.id === drag.id).name, drag.source.dataset.ownedId ? '--pixel' : '--dojo-selected-pixel');
      // Body avoids the Dojo's transformed containing block; fixed stays in viewport coordinates.
      document.body.append(follower);
      drag.follower = follower;
    }
    drag.active = true;
    drag.follower.style.left = `${event.clientX}px`;
    drag.follower.style.top = `${event.clientY}px`;
    event.preventDefault();
    const slot = targetSlot(event.clientX, event.clientY);
    if (slot !== drag.slot || !root.querySelector('[data-drag-preview]')) showDragPreview(slot);
    drag.slot = slot;
    $('[data-owned-inventory]').toggleAttribute('data-drop-remove', slot < 0 && drag.source.matches('[data-fighter="team"]') && overInventory(event.clientX, event.clientY));
  }
  function finishDrag(event) {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    const current = drag;
    drag = null;
    current.follower?.remove();
    $('[data-owned-inventory]').removeAttribute('data-drop-remove');
    clearPreview();
    if (current.source.hasPointerCapture(current.pointerId)) current.source.releasePointerCapture(current.pointerId);
    if (!current.active) return;
    suppressClick = true;
    if (event.type !== 'pointerup') return;
    const slot = targetSlot(event.clientX, event.clientY);
    const previous = state.ids.indexOf(current.id);
    if (slot >= 0) {
      if (previous >= 0) state.ids[previous] = state.ids[slot] || '';
      state.ids[slot] = current.id;
    } else {
      if (!current.source.matches('[data-fighter="team"]') || !overInventory(event.clientX, event.clientY)) return;
      state.ids = state.ids.filter(id => id && id !== current.id);
    }
    state.saved = '';
    $('[data-selection-feedback]').textContent = '';
    update();
  }
  function blockDragClick(event) {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function cancelDrag(event) {
    if (event.type === 'keydown' && event.key !== 'Escape') return;
    if (drag) { event.preventDefault(); finishDrag(event); }
  }
  window.addEventListener('keydown', cancelDrag);
  window.addEventListener('blur', cancelDrag);
  root.addEventListener('pointerdown', pointerdown);
  root.addEventListener('pointermove', pointermove);
  root.addEventListener('pointerup', finishDrag);
  root.addEventListener('pointercancel', finishDrag);
  root.addEventListener('lostpointercapture', finishDrag);
  root.addEventListener('click', blockDragClick, true);
  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.opponentMode) { opponentMode = button.dataset.opponentMode; update(); }
    if (button.hasAttribute('data-create-room')) setRoom(createDemoRoom(), false);
    if (button.hasAttribute('data-copy-room')) void copyRoom();
    if (button.hasAttribute('data-share-room')) void shareRoom();
    if (button.hasAttribute('data-inventory-prev')) { inventoryPage--; paginateInventory(); }
    if (button.hasAttribute('data-inventory-next')) { inventoryPage++; paginateInventory(); }
    if (button.dataset.ownedId) {
      const id = button.dataset.ownedId;
      const previous = state.ids.indexOf(id);
      if (previous >= 0) state.ids = state.ids.filter(item => item && item !== id);
      else if (state.ids.filter(Boolean).length < 3) {
        const slot = [0, 1, 2].find(index => !state.ids[index]);
        state.ids[slot] = id;
      }
      else {
        $('[data-selection-feedback]').textContent = 'Team full — remove a lobster first.';
        return;
      }
      state.saved = '';
      $('[data-selection-feedback]').textContent = '';
      update();
    }
    if (button.dataset.dojoPanel) {
      $('.dojo-cards').dataset.activePanel = button.dataset.dojoPanel;
      root.querySelectorAll('[data-dojo-panel]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
    }
    if (button.dataset.teamMode) { state.mode = button.dataset.teamMode; update(); }
    if (button.dataset.choice) { state[button.dataset.choice] = button.dataset.value; update(); }
    if (button.matches('[data-train]')) {
      if (opponentMode === 'friend') {
        if (!roomJoined || !valid()) return;
        $('[data-preview-summary]').textContent = summary();
        $('.dojo-dialog').showModal();
        return;
      }
      if (!connected) { connected = true; $('[data-dojo-status]').textContent = 'Preview connected. No wallet was accessed.'; update(); return; }
      if (running) { preview(); return; }
      if (busy || !valid()) return;
      busy = true;
      const snapshot = summary();
      $('[data-dojo-status]').textContent = 'Starting local practice…';
      update();
      timer = setTimeout(() => {
        busy = false;
        if (scenario === 'error') { $('[data-dojo-status]').textContent = 'Could not start the dojo battle. Simulated preview error — try again.'; update(); return; }
        running = snapshot; save(); update();
        $('[data-dojo-status]').textContent = 'Practice setup ready. Local preview only.';
        preview();
      }, 650);
    }
    if (button.matches('[data-close-preview]')) $('.dojo-dialog').close();
    if (button.matches('[data-end-preview]')) { running = null; save(); $('.dojo-dialog').close(); $('[data-dojo-status]').textContent = 'Practice ended. Ready for a new team.'; update(); }
  }
  function change(event) {
    const input = event.target;
    if (input.matches('[data-saved-team]')) { state.saved = input.value; state.ids = teams.find(team => team.id === input.value)?.names.slice() || []; $('[data-selection-feedback]').textContent = ''; }
    if (input.matches('[data-builder-slot]')) state.builder[Number(input.dataset.builderSlot)] = input.value;
    if (input.matches('[data-bot]')) state.bot = input.value;
    update();
  }
  function keydown(event) {
    if (event.target.matches('[data-opponent-mode]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      opponentMode = event.key === 'Home' ? 'bot' : event.key === 'End' ? 'friend' : opponentMode === 'bot' ? 'friend' : 'bot';
      update(); $(`[data-opponent-mode="${opponentMode}"]`).focus(); return;
    }
    if (!event.target.matches('[data-team-mode]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    state.mode = event.key === 'Home' ? 'owned' : event.key === 'End' ? 'builder' : state.mode === 'owned' ? 'builder' : 'owned';
    update(); $(`[data-team-mode="${state.mode}"]`).focus();
  }
  root.addEventListener('click', click); root.addEventListener('change', change); root.addEventListener('keydown', keydown);
  $('[data-join-form]').addEventListener('submit', joinRoom);
  if (new URLSearchParams(location.search).has('dojoRoom')) {
    opponentMode = 'friend';
    $('.dojo-cards').dataset.activePanel = 'opponent';
    root.querySelectorAll('[data-dojo-panel]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.dojoPanel === 'opponent')));
    const code = parseDemoRoom(location.href, location.href);
    if (code) setRoom(code, true);
    else { $('[data-join-error]').textContent = 'Invalid demo room link. Create a room or enter a valid code.'; }
  }
  update();
  return () => {
    mobileRoom.removeEventListener('change', fitRoom);
    $('[data-join-form]').removeEventListener('submit', joinRoom);
    finishDrag({ type: 'unmount' });
    window.removeEventListener('keydown', cancelDrag);
    window.removeEventListener('blur', cancelDrag);
    root.removeEventListener('pointerdown', pointerdown);
    root.removeEventListener('pointermove', pointermove);
    root.removeEventListener('pointerup', finishDrag);
    root.removeEventListener('pointercancel', finishDrag);
    root.removeEventListener('lostpointercapture', finishDrag);
    root.removeEventListener('click', blockDragClick, true);
    headings.remove(); inventoryObserver.disconnect(); fighterObserver.disconnect(); atlas.onload = null; shortScreen.removeEventListener('change', fitGuide); clearTimeout(timer); $('.dojo-dialog')?.close(); root.removeEventListener('click', click); root.removeEventListener('change', change); root.removeEventListener('keydown', keydown); };
}
