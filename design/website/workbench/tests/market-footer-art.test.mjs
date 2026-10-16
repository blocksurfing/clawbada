import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelSourceWatch } from '../tools/pixel-source-watch.js';
import { pixelAssets } from '../pixel-assets.js';
test('horizontal footer strip validates as three 16px tiles from current export',()=>{
 const strip={kind:'panel',src:pixelAssets.marketCard.src,width:208,height:128,region:[0,96,48,32],tile:16,horizontal:true};
 assert.doesNotThrow(()=>pixelSourceWatch({strip}).buildStart.call({addWatchFile(){}}));
});
