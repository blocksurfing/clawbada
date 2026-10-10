import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

export function pixelSourceWatch(assets) {
  const entries = Object.entries(assets).map(([name, asset]) => ({name, asset, file:fileURLToPath(asset.src)}));
  function validate({name,asset,file}) {
    const png = PNG.sync.read(readFileSync(file));
    if (png.width !== asset.width || png.height !== asset.height) throw new Error(`${name}: source is ${png.width}x${png.height}; update pixel-assets.js if the sheet layout changed.`);
    if (asset.kind==='panel') {
      const [x,y,w,h]=asset.region;
      if (w!==asset.tile*3 || h!==asset.tile*3 || x<0 || y<0 || x+w>png.width || y+h>png.height) throw new Error(`${name}: invalid nine-slice region`);
    } else if (png.width%asset.frame[0] || png.height%asset.frame[1]) throw new Error(`${name}: frames do not fit the sheet`);
  }
  return {
    name: 'clawbada-pixel-source-watch',
    buildStart() { for (const entry of entries) { this.addWatchFile(entry.file); validate(entry); } },
    configureServer(server) {
      server.watcher.add(entries.map(e=>e.file));
      const update = file => {
        const entry=entries.find(e=>e.file===resolve(file));
        if (!entry) return;
        try { validate(entry); server.ws.send({type:'full-reload',path:'*'}); }
        catch(error) { server.config.logger.error(error.message); server.ws.send({type:'error',err:{message:error.message,stack:error.stack,plugin:'clawbada-pixel-source-watch'}}); }
      };
      server.watcher.on('change',update);
      server.watcher.on('add',update);
      server.httpServer?.once('close',()=>{server.watcher.off('change',update);server.watcher.off('add',update);});
    },
  };
}
