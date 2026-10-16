import test from 'node:test';
import assert from 'node:assert/strict';

test('filters combine, price sorts numerically, pagination clamps and fixtures stay unchanged', async () => {
  const { demoListings, selectListings } = await import('../components/market.js');
  for (const [key,value] of Object.entries({type:'Eggs',klass:'Bulwark',tier:'Apex',rarity:'Epic'})) {
    const result = selectListings(demoListings, {[key]:value});
    assert.ok(result.total > 0);
    assert.ok(result.items.every(item => item[key] === value));
  }
  assert.deepEqual(selectListings(demoListings, {type:'Lobsters',klass:'Bulwark',tier:'Evolved',purity:'5',minPrice:'2000',maxPrice:'3000',rarity:'Rare'}).items.map(i=>i.id), ['D011']);
  assert.equal(selectListings(demoListings, {purity:'7'}).total, 0);
  assert.equal(selectListings(demoListings, {minPrice:'3000',maxPrice:'1000'}).total, 0);
  assert.equal(selectListings(demoListings, {sort:'price-asc'}).items[0].id, 'D012');
  assert.equal(selectListings(demoListings, {sort:'price-desc'}).items[0].id, 'D005');
  assert.equal(selectListings(demoListings, {sort:'purity-desc'}).items[0].purity, 6);
  assert.equal(selectListings(demoListings, {type:'Eggs'}, 20).page, 1);
  assert.equal(selectListings(demoListings, {}, -2).page, 1);
  assert.ok(demoListings.filter(i => i.type === 'Eggs').every(i => i.klass === null && i.tier === null && i.purity === null && i.breed === null));
  assert.ok(selectListings(demoListings, {purity:'0'}).items.every(i => i.type !== 'Eggs'));
  assert.equal(demoListings[0].id, 'D001');
});

test('market fills two four-column rows before paging remaining listings', async () => {
  const { demoListings, selectListings } = await import('../components/market.js');
  assert.equal(demoListings.length, 12);
  assert.equal(new Set(demoListings.map(item => item.id)).size, 12);
  const first = selectListings(demoListings);
  assert.equal(first.total, 12);
  assert.equal(first.pages, 2);
  assert.equal(first.items.length, 8);
  const second = selectListings(demoListings, {}, 2);
  assert.equal(second.items.length, 4);
  assert.ok(second.items.every(item => !first.items.includes(item)));
});
