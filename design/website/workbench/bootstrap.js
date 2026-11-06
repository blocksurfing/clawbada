import './styles/web-loading.css';
import { prepareWebLoading } from './components/web-loading.js';
import { isDojoRoute } from './routes.js';
const preview = new URLSearchParams(location.search).get('loading') === 'preview';
const root = document.querySelector('#web-loading');
async function boot() {
  try {
    if (!isDojoRoute(location.hash)) {
      await import('./coming-soon.js');
      root.remove();
      document.body.classList.remove('web-is-loading');
      document.querySelector('#app').inert = false;
      return;
    }
    const finish = await prepareWebLoading();
    // Mockup only: real integration will replace this with Unity's ready signal.
    await import('./main.js');
    await document.fonts.ready;
    if (preview) {
      const controls = document.createElement('div');
      controls.className = 'loading-preview-controls';
      controls.innerHTML = '<button type="button">Finish preview</button>';
      root.append(controls);
      controls.querySelector('button').addEventListener('click', finish, { once:true });
    } else {
      await new Promise(resolve => setTimeout(resolve, 2500));
      await finish();
    }
  } catch (error) {
    console.error('Web loading failed', error);
    root.querySelector('.web-loading-label').textContent = 'Unable to load';
    const retry = document.createElement('button');
    retry.className = 'loading-retry'; retry.textContent = 'Retry';
    retry.addEventListener('click', () => location.reload()); root.append(retry);
  }
}
boot();
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
