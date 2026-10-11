import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const moduleURL = new URL('../routes.js', import.meta.url);
test('every existing sidebar destination resolves to its own editable page; unknown routes fall back', async () => {
  assert.ok(existsSync(moduleURL), 'workspace route module must exist');
  const { routes, resolveRoute } = await import(moduleURL);
  const expected = ['dashboard','mining','battle','dojo','breeding','evolve','repair','teams','market','activity','ranks','docs'];
  assert.deepEqual(Object.keys(routes), expected);
  for (const slug of expected) {
    assert.equal(resolveRoute('#/' + slug), slug);
    const html = readFileSync(new URL('../pages/' + slug + '.html', import.meta.url), 'utf8');
    if (slug === 'dashboard') {
      assert.equal(routes.dashboard, 'Shell');
      assert.ok(html.includes('class="shell-room"'));
      assert.equal((html.match(/class="lobby-slot"/g) || []).length, 3);
      assert.match(html, /class="shell-battle"[^>]*disabled/);
      for (const view of ['queue', 'active', 'history']) {
        assert.ok(html.includes(`data-shell-tab="${view}"`));
        assert.ok(html.includes(`aria-controls="shell-${view}"`));
      }
      assert.equal((html.match(/aria-expanded="false"/g) || []).length, 3);
      assert.ok(!html.includes('data-pixel-panel'), 'room is not wrapped in a wooden panel');
    } else if (slug === 'mining') {
      assert.equal((html.match(/class="wooden-panel mining-card"/g) || []).length, 4);
      for (const tier of ['Base', 'Evolved', 'Elite', 'Apex']) assert.ok(html.includes(`${tier} Mine`));
      for (const reward of ['1,250', '3,750', '12,500', '31,250']) assert.ok(html.includes(`${reward} $GOLD`));
      assert.equal((html.match(/<dd>4 hours<\/dd>/g) || []).length, 4);
      assert.ok(!/<img|data-pixel-sprite|<button/.test(html), 'mining is wooden panels and text only');
    } else if (slug === 'battle') {
      assert.equal((html.match(/class="wooden-panel battle-lobby"/g) || []).length, 1);
      assert.ok(!/Practice|Queue|Active|History|practice-/.test(html));
      assert.equal((html.match(/class="lobby-slot"/g) || []).length, 0);
      assert.ok(html.includes('id="battle-arena"'));
      assert.match(html, /<button[^>]*disabled[^>]*>Find Match<\/button>/);
      assert.ok(html.includes('Not connected'));
      assert.ok(!/<img|data-pixel-sprite/.test(html), 'no new Battle artwork');
    } else {
      assert.equal(html.replace(/<!--[\s\S]*?-->/g, '').trim(), '', 'other pages remain empty');
    }
    assert.ok(existsSync(new URL('../styles/pages/' + slug + '.css', import.meta.url)));
  }
  for (const invalid of ['', '#/', '#/missing', '#/<script>']) assert.equal(resolveRoute(invalid), 'dashboard');
});
