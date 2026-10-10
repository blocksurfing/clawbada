import './styles/shared.css';
import './styles/page-colors.css';
import { pageColors, pageThemes } from './page-colors.js';
import './styles/body-font.css';
import './styles/wooden-panel.css';
import './styles/pixel.css';
import { mountPixelUI } from './components/pixel/index.js';
import './styles/page-header.css';
import { createPageTransition } from './components/page-transition.js';
import './styles/placeholders.css';
import sidebar from './components/sidebar.html?raw';
import userSection from './components/user-section.html?raw';
import { initShell } from './components/shell.js';
import { routes, resolveRoute } from './routes.js';
import { mountBattleLobby } from './components/battle-lobby.js';
import { mountShellArt } from './components/shell-art.js';
import { createBattleModal } from './components/battle-modal.js';
import { mountShellTabs } from './components/shell-tabs.js';

const pages = import.meta.glob('./pages/*.html', { query: '?raw', import: 'default', eager: true });
import.meta.glob('./styles/pages/*.css', { eager: true });
const logo = new URL('../brand/logo-wordmark-512x512.png', import.meta.url).href;
document.querySelector('#app').innerHTML = sidebar.replace('../brand/logo-wordmark-512x512.png', logo) + userSection + '<main id="page-content" class="workspace-placeholder"></main>';
const main = document.querySelector('#page-content');
function syncHeaderScroll() {
  // Remove the compact header inset as it crosses the existing top padding.
  const topPadding = parseFloat(getComputedStyle(main).paddingTop) || 48;
  main.style.setProperty('--header-top-progress', String(Math.max(0, 1 - main.scrollTop / topPadding)));
}
main.addEventListener('scroll', syncHeaderScroll, { passive: true });
let disposePixelUI = () => {};
function render(slug) {
  disposePixelUI();
  main.innerHTML = (slug === 'dashboard' ? '' : `<header class="page-header"><h1 class="page-title">${routes[slug]}</h1>${slug === 'mining' ? '<p class="page-subtitle">Send teams on 4-hour expeditions to earn $GOLD</p>' : slug === 'battle' ? '<p class="page-subtitle">PvP combat — wager $GOLD, winner takes the pot</p>' : ''}</header>`) + pages[`./pages/${slug}.html`];
  main.dataset.page = slug;
  document.body.style.backgroundColor = pageColors[slug];
  document.body.dataset.pageTheme = pageThemes[slug];
  main.setAttribute('aria-label', `${routes[slug]} design placeholder`);
  main.scrollTop = 0;
  syncHeaderScroll();
  const disposePanels = mountPixelUI(main);
  const disposeLobby = mountBattleLobby(main);
  const disposeArt = mountShellArt(main);
  const disposeTabs = mountShellTabs(main);
  disposePixelUI = () => { disposeTabs(); disposeLobby(); disposeArt(); disposePanels(); };
  document.title = `Clawbada · ${routes[slug]} · Design workbench`;
}
const battleModal = createBattleModal();
let battleButtonBusy = false;
main.addEventListener('click', async event => {
  const button = event.target.closest('.shell-battle');
  if (!button || button.disabled || button.closest('[inert]')) return;
  event.preventDefault();
  if (battleButtonBusy) return;
  battleButtonBusy = true;
  button.dataset.pressed = 'true';
  const motion = button.animate([
    { translate:'0 0' },
    { translate:'0 2px', offset:0.4 },
    { translate:'0 0' }
  ], { duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160, easing:'ease-out' });
  try {
    await motion.finished;
    if (button.isConnected) battleModal.open();
  } catch { /* Animation cancelled by navigation. */ }
  finally { delete button.dataset.pressed; battleButtonBusy = false; }
});
const initialBattle = resolveRoute(location.hash) === 'battle';
const initial = initialBattle ? 'dashboard' : resolveRoute(location.hash);
render(initial);
history.replaceState(null, '', '#/' + initial);
if (initialBattle) battleModal.open();
const shell = initShell(routes[initial], label => {
  const slug = Object.keys(routes).find(key => routes[key] === label) || 'dashboard';
  if (slug === 'battle') { battleModal.open(); shell.selectMenu(routes[main.dataset.page]); return; }
  if (location.hash !== '#/' + slug) location.hash = '/' + slug;
});
const pageTransition = createPageTransition(main, render, initial);
window.addEventListener('hashchange', () => {
  const slug = resolveRoute(location.hash);
  if (slug === 'battle') {
    history.replaceState(null, '', '#/' + main.dataset.page);
    battleModal.open();
    return;
  }
  if (location.hash !== '#/' + slug) history.replaceState(null, '', '#/' + slug);
  pageTransition.navigate(slug);
  shell.selectMenu(routes[slug]);
});
// HTML fragments are raw imports: full reload on edits prevents duplicate shell listeners.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
