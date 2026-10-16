import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { pixelAssets } from '../pixel-assets.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('optional artist sync handles startup, edits, atomic exports, missing sources and cleanup', async () => {
  const { marketSheetSync } = await import('../tools/market-sheet-sync.js');
  const dir=mkdtempSync(join(tmpdir(),'market-sync-'));
  try {
    const sourceRoot=join(dir,'artist'), targetRoot=join(dir,'bundled');
    mkdirSync(join(targetRoot,'Base'),{recursive:true});
    const target=join(targetRoot,'Base/Sheet.png'), source=join(sourceRoot,'Base/Sheet.png');
    writeFileSync(target,'bundled fallback');
    const watcher=new EventEmitter(), httpServer=new EventEmitter(), watched=[];
    watcher.add=files=>watched.push(...files);
    const server={watcher,httpServer,config:{logger:{warn:message=>assert.fail(message)}}};
    const plugin=marketSheetSync({sourceRoot,targetRoot});
    assert.equal(plugin.apply,'serve');
    plugin.configureServer(server);
    assert.equal(readFileSync(target,'utf8'),'bundled fallback');
    httpServer.emit('close');
    mkdirSync(join(sourceRoot,'Base'),{recursive:true});
    writeFileSync(source,'startup export');
    plugin.configureServer(server);
    assert.equal(readFileSync(target,'utf8'),'startup export');
    assert.ok(watched.includes(source));
    for (const event of ['change','add']) {
      writeFileSync(source,event);
      watcher.emit(event,source);
      assert.equal(readFileSync(target,'utf8'),event);
    }
    rmSync(source);
    watcher.emit('change',source);
    assert.equal(readFileSync(target,'utf8'),'add');
    httpServer.emit('close');
    assert.equal(watcher.listenerCount('change'),0);
    assert.equal(watcher.listenerCount('add'),0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('real dev watcher copies an artist edit and automatically sends a reload', async () => {
  const { createServer } = await import('vite');
  const { PNG } = await import('pngjs');
  const { pathToFileURL } = await import('node:url');
  const { marketSheetSync } = await import('../tools/market-sheet-sync.js');
  const { pixelSourceWatch } = await import('../tools/pixel-source-watch.js');
  const dir=mkdtempSync(join(tmpdir(),'market-live-'));
  let server;
  try {
    const sourceRoot=join(dir,'artist'), targetRoot=join(dir,'assets');
    const source=join(sourceRoot,'Base/Sheet.png'), target=join(targetRoot,'Base/Sheet.png');
    mkdirSync(join(sourceRoot,'Base'),{recursive:true});
    const png=new PNG({width:640,height:64});
    writeFileSync(source,PNG.sync.write(png));
    server=await createServer({configFile:false,root:dir,logLevel:'silent',
      plugins:[marketSheetSync({sourceRoot,targetRoot}),pixelSourceWatch({base:{kind:'sprite',src:pathToFileURL(target).href,width:640,height:64,frame:[64,64]}})],
      server:{host:'127.0.0.1',port:0,watch:{usePolling:true,interval:50,awaitWriteFinish:{stabilityThreshold:100,pollInterval:25}}},
    });
    await server.listen();
    const messages=[];
    server.ws.send=message=>messages.push(message);
    // Wait for the actual source and destination watcher registrations.
    const until=async predicate=>{
      const end=Date.now()+5000;
      while (!predicate()) {
        assert.ok(Date.now()<end,'watch/copy/reload timed out');
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    };
    await until(()=>Object.values(server.watcher.getWatched()).filter(files=>files.includes('Sheet.png')).length===2);
    png.data.fill(255);
    const edited=PNG.sync.write(png);
    writeFileSync(source,edited);
    await until(()=>readFileSync(target).equals(edited) && messages.some(message=>message.type==='full-reload'));
    assert.equal(hash(readFileSync(source)),hash(readFileSync(target)));
  } finally { await server?.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('all four market sheets are bundled locally and match available artist exports', () => {
  for (const tier of ['Base', 'Evolved', 'Elite', 'Apex']) {
    const asset = pixelAssets[`market${tier}`];
    const local = new URL(`../assets/market/${tier}/Sheet.png`, import.meta.url);
    assert.equal(asset.src, local.href);
    const bytes = readFileSync(local);
    assert.equal(bytes.readUInt32BE(16), 640);
    assert.equal(bytes.readUInt32BE(20), 64);
    const artist = new URL(`../../../../../base/${tier}/Sheet.png`, import.meta.url);
    if (existsSync(artist)) assert.equal(hash(bytes), hash(readFileSync(artist)));
  }
});
