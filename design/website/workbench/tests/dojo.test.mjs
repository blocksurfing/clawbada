import test from 'node:test';
import assert from 'node:assert/strict';
import { dojoSummary, purityDescription, dojoClasses, dojoBots } from '../components/dojo.js';
test('dojo reference defaults and purity endpoints', () => {
  assert.equal(purityDescription(6), 'Specials hit 160% as hard and fire their enhanced version 35% of the time.');
  assert.match(purityDescription(0), /100%.*5%/);
  assert.equal(dojoClasses.length, 10);
  assert.equal(dojoBots[0].label, 'Balanced');
});
test('dojo summary resolves saved teams, custom teams, and arena override', () => {
  const state = { mode: 'owned', saved: '12', names: ['Mantis','Kraken','Ember'], tier: 'Evolved', bot: 'Balanced', opponent: 'Mirror mine', arena: 'Match team' };
  assert.equal(dojoSummary(state), 'Team #12 vs Balanced bot · mirror roster · Evolved arena');
  assert.equal(dojoSummary({ ...state, mode: 'builder', arena: 'Apex', opponent: 'Random classes' }), 'Mantis / Kraken / Ember vs Balanced bot · random classes · Apex arena');
});
