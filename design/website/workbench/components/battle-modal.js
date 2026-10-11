import battleHTML from '../pages/battle.html?raw';
import { mountPixelUI } from './pixel/index.js';
import '../styles/battle-modal.css';

export function createBattleModal() {
  const dialog = document.createElement('dialog');
  dialog.className = 'battle-modal';
  dialog.dataset.page = 'battle';
  dialog.setAttribute('aria-labelledby', 'battle-modal-title');
  dialog.innerHTML = `<header class="battle-modal-header"><h1 id="battle-modal-title">Battle</h1><button type="button" class="battle-modal-close" aria-label="Close Battle">Close</button></header>${battleHTML}`;
  document.body.append(dialog);

  let disposePanels, motion, closing = false, opener;
  const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280;
  function open() {
    if (dialog.open) return;
    opener = document.activeElement;
    closing = false;
    dialog.showModal();
    if (!disposePanels) disposePanels = mountPixelUI(dialog);
    motion = dialog.animate([{transform:'translateY(100vh)', opacity:0}, {transform:'translateY(0)', opacity:1}], {duration:duration(), easing:'cubic-bezier(.22,1,.36,1)'});
    dialog.querySelector('.battle-modal-close').focus({preventScroll:true});
  }
  async function close() {
    if (!dialog.open || closing) return;
    closing = true;
    motion?.cancel();
    motion = dialog.animate([{transform:'translateY(0)', opacity:1}, {transform:'translateY(100vh)', opacity:0}], {duration:duration(), easing:'ease-in', fill:'forwards'});
    try { await motion.finished; } catch { return; }
    disposePanels?.();
    disposePanels = null;
    dialog.querySelectorAll('.pixel-panel-art').forEach(canvas => canvas.remove());
    dialog.querySelectorAll('[data-pixel-ready]').forEach(panel => panel.removeAttribute('data-pixel-ready'));
    dialog.close();
    motion.cancel();
    closing = false;
    if (opener?.isConnected) opener.focus({preventScroll:true});
  }
  dialog.querySelector('.battle-modal-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    if (event.target !== dialog) return;
    event.preventDefault(); close();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
  });
  return { open, close, dispose() { motion?.cancel(); disposePanels?.(); dialog.remove(); } };
}
