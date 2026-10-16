import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional artist workspace input, never a build dependency. Vite's polling /
// awaitWriteFinish watcher handles exports on mounted drives and atomic saves.
export function marketSheetSync({
  sourceRoot = fileURLToPath(new URL('../../../../../base/', import.meta.url)),
  targetRoot = fileURLToPath(new URL('../assets/market/', import.meta.url)),
} = {}) {
  const sheets = new Map(['Base','Evolved','Elite','Apex'].map(tier => [
    resolve(sourceRoot,tier,'Sheet.png'), join(targetRoot,tier,'Sheet.png'),
  ]));
  return {
    name: 'clawbada-market-sheet-sync',
    apply: 'serve',
    configureServer(server) {
      const sync = file => {
        const target = sheets.get(resolve(file));
        if (!target) return;
        try {
          const bytes = readFileSync(file);
          if (existsSync(target) && bytes.equals(readFileSync(target))) return;
          mkdirSync(dirname(target), {recursive:true});
          writeFileSync(target, bytes);
          // pixelSourceWatch validates the local copy and reloads automatically.
        } catch (error) {
          if (error.code !== 'ENOENT') server.config.logger.warn(`Market sheet sync: ${error.message}`);
        }
      };
      for (const source of sheets.keys()) sync(source);
      server.watcher.add([...sheets.keys()]);
      server.watcher.on('change',sync);
      server.watcher.on('add',sync);
      server.httpServer?.once('close', () => {
        server.watcher.off('change',sync);
        server.watcher.off('add',sync);
      });
    },
  };
}
