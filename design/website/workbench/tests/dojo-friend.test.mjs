import test from 'node:test';
import assert from 'node:assert/strict';

test('demo room codes and links validate without accepting external URLs', async () => {
  const { parseDemoRoom, createDemoRoom, demoRoomLink } = await import('../components/dojo-friend.js');
  const base = 'http://127.0.0.1:4275/';
  const code = createDemoRoom();
  assert.match(code, /^DEMO-[A-Z0-9]{6}$/);
  assert.equal(parseDemoRoom(`  ${code.toLowerCase()}  `, base), code);
  const link = demoRoomLink(code, `${base}?dojoState=error#/market`);
  assert.equal(link, `${base}?dojoRoom=${code}#/dojo`);
  assert.equal(parseDemoRoom(link, base), code);
  for (const input of ['', 'ABC', 'DEMO-1234567', 'DEMO-<img/>', `https://evil.test/?dojoRoom=${code}#/dojo`, `${base}?dojoRoom=${code}#/market`, `${base}?dojoRoom=${code}&dojoRoom=${code}#/dojo`, 'javascript:alert(1)']) {
    assert.equal(parseDemoRoom(input, base), null, input);
  }
});
