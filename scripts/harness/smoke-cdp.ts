import type { Browser } from './cdp';
export default async function (b: Browser) {
  await b.goto('http://127.0.0.1:3000/game/battle');
  const title = await b.eval('document.title');
  const ok = await b.waitFor(`/BATTLE/i.test(document.body.innerText)`, 30000, 500);
  await b.screenshot(`${import.meta.dir}/out/cdp-smoke.png`);
  console.log(`[cdp-smoke] title=${JSON.stringify(title)} pageReady=${ok} logs=${b.logs.length}`);
}
