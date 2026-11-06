import './styles/shared.css';
import './styles/body-font.css';
import './styles/pixel.css';
import './styles/wooden-panel.css';
import { mountPixelUI } from './components/pixel/index.js';
import './styles/coming-soon.css';
import { isDojoRoute } from './routes.js';
import construction from '../site/Under Construction/Under Construction.json';
const constructionSheet = new URL('../site/Under Construction/Under Construction.png', import.meta.url).href;

document.title = 'Clawbada · Coming Soon';
document.querySelector('#app').innerHTML = `
  <main class="coming-soon" aria-labelledby="coming-soon-title">
    <div class="coming-soon-content">
      <div class="construction-art" role="img" aria-label="Lobsters at work with a wheelbarrow"></div>
      <h1 id="coming-soon-title">WE’RE COMING SOON</h1>
      <p>Clawbada is getting ready. In the meantime, step into the Dojo and put your skills to the test.</p>
      <div class="coming-soon-actions">
        <a class="pixel-button coming-soon-action" data-pixel-panel="globalGoldenButton" data-button-shine href="#/dojo">ENTER DOJO</a>
        <div class="coming-soon-socials">
          <a class="pixel-icon-button" href="https://x.com/clawbada" target="_blank" rel="noopener noreferrer" aria-label="X / Twitter">
            <span class="icon-normal" data-pixel-sprite="socialXNormal" aria-hidden="true"></span>
            <span class="icon-pressed" data-pixel-sprite="socialXPressed" aria-hidden="true"></span>
          </a>
          <button class="pixel-icon-button" type="button" aria-label="Discord">
            <span class="icon-normal" data-pixel-sprite="socialDiscordNormal" aria-hidden="true"></span>
            <span class="icon-pressed" data-pixel-sprite="socialDiscordPressed" aria-hidden="true"></span>
          </button>
          <a class="pixel-icon-button" href="https://docs.clawbada.com" target="_blank" rel="noopener noreferrer" aria-label="Docs">
            <span class="icon-normal" data-pixel-sprite="socialDocsNormal" aria-hidden="true"></span>
            <span class="icon-pressed" data-pixel-sprite="socialDocsPressed" aria-hidden="true"></span>
          </a>
        </div>
      </div>
    </div>
  </main>`;
const art = document.querySelector('.construction-art');
const disposePixelUI = mountPixelUI(document.querySelector('.coming-soon'));
if (import.meta.hot) import.meta.hot.dispose(disposePixelUI);
const frame = construction.frames[0].frame;
art.style.setProperty('--art-width', frame.w);
art.style.setProperty('--art-height', frame.h);
art.style.setProperty('--sheet-width', construction.meta.size.w);
art.style.backgroundImage = `url("${constructionSheet}")`;
art.style.animationDuration = `${construction.frames.reduce((sum, item) => sum + item.duration, 0)}ms`;
art.style.animationTimingFunction = `steps(${construction.frames.length})`;
window.addEventListener('hashchange', () => {
  if (isDojoRoute(location.hash)) location.reload();
});
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
