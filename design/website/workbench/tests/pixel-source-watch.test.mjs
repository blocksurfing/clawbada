import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { pixelSourceWatch } from '../tools/pixel-source-watch.js';

test('registered exports are validated, watched and reloaded without modifying source artwork', () => {
 const dir=mkdtempSync(join(tmpdir(),'pixel-watch-'));
 try {
  const source=join(dir,'source.png');
  const image=new PNG({width:192,height:192});image.data.fill(255);
  writeFileSync(source,PNG.sync.write(image));
  const assets={panel:{kind:'panel',src:pathToFileURL(source).href,width:192,height:192,region:[0,0,48,48],tile:16}};
  const plugin=pixelSourceWatch(assets), watched=[], messages=[],handlers={},errors=[];
  plugin.buildStart.call({addWatchFile(file){watched.push(file);}});
  assert.deepEqual(watched,[source]);
  plugin.configureServer({watcher:{add(){},on(event,fn){handlers[event]=fn;}},ws:{send(m){messages.push(m);}},config:{logger:{error(e){errors.push(e);}}}});
  for (const event of ['change','add']) {
   image.data[0]--;const bytes=PNG.sync.write(image);writeFileSync(source,bytes);
   handlers[event](source);
   assert.equal(messages.at(-1).type,'full-reload');
   assert.deepEqual(readFileSync(source),bytes);
  }
  writeFileSync(source,PNG.sync.write(new PNG({width:16,height:16})));
  handlers.change(source);
  assert.equal(messages.at(-1).type,'error');
  assert.match(errors[0],/update pixel-assets.js/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
