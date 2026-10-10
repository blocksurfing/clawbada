import { defineConfig } from 'vite';
import { pixelAssets } from './pixel-assets.js';
import { pixelSourceWatch } from './tools/pixel-source-watch.js';
export default defineConfig({
  plugins: [pixelSourceWatch(pixelAssets)],
  base: './',
  server: { host: '0.0.0.0', port: 4275, strictPort: true,
    watch: { usePolling: true, interval: 500, awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 } },
    fs: { allow: ['..', '../../../packages/battle-engine/ClawbadaBattle/Assets/Art/UI/Avatar', '../../../packages/battle-engine/ClawbadaBattle/Assets/Art/Arenas/Elite/Decoration/Foreground Seaweed'] } },
  preview: { host: '127.0.0.1', port: 4276, strictPort: true },
  build: { assetsInlineLimit: 0 },
});
