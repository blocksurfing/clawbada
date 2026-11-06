import test from 'node:test';
import assert from 'node:assert/strict';
import * as routing from '../routes.js';

test('temporary public access allows only Dojo', () => {
  assert.equal(typeof routing.isDojoRoute, 'function');
  assert.equal(routing.isDojoRoute('#/dojo'), true);
  for (const route of ['', '#/', '#/unknown', '#/coming-soon', ...Object.keys(routing.routes).filter(r => r !== 'dojo').map(r => '#/' + r)]) {
    assert.equal(routing.isDojoRoute(route), false, route);
  }
});
