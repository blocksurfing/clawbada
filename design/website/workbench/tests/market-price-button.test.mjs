import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('market buy button carries price and sidebar gold instead of separate price and Buy label', () => {
 const source=readFileSync(new URL('../components/market.js',import.meta.url),'utf8');
 assert.match(source,/class="pixel-button market-buy"/);
 assert.match(source,/data-pixel-sprite="menuIcons" data-frame="8"/);
 assert.doesNotMatch(source,/>Buy<|<span>\$GOLD<\/span>/);
});
