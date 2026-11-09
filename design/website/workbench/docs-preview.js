import documentHtml from '../mockups/docs/index.html?raw';
import globalUiUrl from '../site/Tileset/GlobalUI.png?url';
const resolvedHtml = documentHtml.replace("'../../site/Tileset/GlobalUI.png'", JSON.stringify(new URL(globalUiUrl, location.href).href));
if (import.meta.hot) import.meta.hot.accept('../site/Tileset/GlobalUI.png?url', module => {
  if (module) frame.contentWindow.postMessage({ type: 'docs-global-ui-update', url: new URL(module.default, location.href).href }, location.origin);
});

// Keep the captured docs isolated from game UI styles until its redesign.
document.title = 'Clawbada · Docs · Design workbench';
const frame = document.createElement('iframe');
frame.title = 'Clawbada documentation mockup';
frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:white';
const documentUrl = URL.createObjectURL(new Blob([resolvedHtml], { type: 'text/html' }));
frame.src = documentUrl;
window.addEventListener('pagehide', () => URL.revokeObjectURL(documentUrl), { once: true });
document.querySelector('#app').replaceChildren(frame);
window.addEventListener('hashchange', () => location.reload());
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
