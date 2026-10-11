// Local class samples only. No inventory, game rules, or network integration.
import { pixelAssets } from '../pixel-assets.js';

const classes = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];

export function mountBattleLobby(root) {
  const dialog = root.querySelector('.lobster-picker');
  if (!dialog) return () => {};
  const slots = [...root.querySelectorAll('.lobby-slot')];
  const choices = new Array(slots.length).fill('');
  const abort = new AbortController();
  const options = dialog.querySelector('.picker-options');
  let active = 0;
  const showClassIcons = root.dataset.page === 'dashboard';
  function classIcon(name) {
    const icon = document.createElement('span');
    icon.className = 'class-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.backgroundImage = `url("${pixelAssets.classBadges.src}")`;
    icon.style.setProperty('--class-frame', String(classes.indexOf(name)));
    return icon;
  }
  options.replaceChildren(...classes.map(name => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.class = name;
    button.textContent = name;
    if (showClassIcons) button.prepend(classIcon(name));
    return button;
  }));
  function select(name) {
    const index = active;
    const slot = slots[index];
    dialog.close();
    slot.focus();
    const commit = () => commitSelection(name, index);
    const event = new CustomEvent('shell-selection', { bubbles:true, cancelable:true, detail:{ name, commit } });
    if (slot.dispatchEvent(event)) commit();
  }
  function commitSelection(name, index) {
    choices[index] = name;
    const slot = slots[index];
    slot.dataset.selected = String(Boolean(name));
    slot.querySelector('.slot-name').textContent = name || 'Choose Lobster';
    if (showClassIcons && name) slot.querySelector('.slot-name').prepend(classIcon(name));
    const character = slot.querySelector('.slot-character');
    if (character) {
      character.hidden = !name;
      character.style.setProperty('--character-frame', String(Math.max(0, classes.indexOf(name))));
      character.dataset.class = name;
    }
    const art = slot.querySelector('.slot-art');
    const hint = slot.querySelector('.slot-hint');
    if (art) art.textContent = name ? 'Art placeholder' : '+';
    if (hint) hint.textContent = name ? 'Click to change' : 'Click to select';
    slot.setAttribute('aria-label', `${name ? `Change ${name}` : 'Choose lobster'} for slot ${index + 1}`);
    const battleButton = root.querySelector('.shell-battle');
    if (battleButton) {
      battleButton.disabled = !choices.some(Boolean);
      battleButton.title = battleButton.disabled ? 'Choose a character first' : 'Battle';
    }
    const status = root.querySelector('.lobby-status');
    if (status) status.textContent = `${choices.filter(Boolean).length} / 3 slots selected`;
  }
  slots.forEach((slot, index) => slot.addEventListener('click', () => {
    active = index;
    slots.forEach(item => item.removeAttribute('data-picker-active'));
    slot.dataset.pickerActive = 'true';
    dialog.querySelector('.picker-heading h2').textContent = `Choose Lobster · Slot ${index + 1}`;
    options.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.class === choices[active])));
    dialog.showModal();
  }, { signal: abort.signal }));
  options.addEventListener('click', event => {
    const button = event.target.closest('button[data-class]');
    if (button) select(button.dataset.class);
  }, { signal: abort.signal });
  dialog.addEventListener('close', () => slots.forEach(slot => slot.removeAttribute('data-picker-active')), { signal: abort.signal });
  dialog.querySelector('.picker-clear').addEventListener('click', () => select(''), { signal: abort.signal });
  dialog.querySelector('.picker-close').addEventListener('click', () => dialog.close(), { signal: abort.signal });
  return () => { if (dialog.open) dialog.close(); abort.abort(); };
}
