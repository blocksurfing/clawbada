/**
 * The lobby squirrel comes out from behind the doorway's wooden frame (owner 2026-11-01, again 2026-11-05: with the
 * sidebar open it appeared in mid-air left of the post; closed, its head showed over the slanted beam).
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts squirrel-doorway.ts
 *
 * At the owner's MacBook viewport (1440×756 @2), sidebar compact and expanded: the frame's inner right edge is measured
 * per row from the backdrop PNG itself (independently of dojo-squirrel.tsx's table); the run-in is filmed with
 * ?squirrel=now and each frame is compared with a frame taken before the run. Passes when the squirrel shows left of
 * the frame (it came out), never on the wood side of it in any frame, and reaches the frame (no cut in mid-air).
 * DUMP=1 writes the frames to out/sqd-*.png.
 */
import type { Browser } from './cdp';

const BACKDROP = '/ui/dojo/Dojo_Dark.png';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 756, deviceScaleFactor: 2, mobile: false });
  // Only the squirrel's neighbourhood (css px; captured at 2 device px per css px).
  let clip = { x: 0, y: 0, width: 1, height: 1, scale: 1 };
  const shot = async () => (await b.send('Page.captureScreenshot', { format: 'png', clip })).data as string;

  for (const state of ['compact', 'expanded'] as const) {
    await b.goto(`${BASE}/dojo?squirrel=now`);
    await b.waitFor(`!!document.querySelector('[data-dojo-sign-board]') && !!document.querySelector('#toggle') && !document.querySelector('#toggle').disabled`, 60000, 200);
    if (state === 'expanded') {
      const t = await b.eval(`(() => { const q = document.querySelector('#toggle').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
      await b.clickAt(t.x, t.y);
    }
    if (!(await b.waitFor(`document.querySelector('[data-testid=dojo-squirrel]')?.dataset.running === 'true'`, 15000, 20))) { ok(false, `${state}: squirrel ran`); continue; }
    // The box is placed once the run starts; a reference frame from the end of the run (squirrel gone) follows below.
    const bx = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-squirrel]').getBoundingClientRect(); return { x: Math.max(0, Math.floor(q.left - 20)), y: Math.max(0, Math.floor(q.top)), r: Math.ceil(q.right + 60), b: Math.ceil(q.bottom) }; })()`) as { x: number; y: number; r: number; b: number };
    clip = { x: bx.x, y: bx.y, width: bx.r - bx.x, height: bx.b - bx.y, scale: 1 };
    const frames: string[] = [];
    for (let i = 0; i < 18; i++) { frames.push(await shot()); await b.sleep(40); }
    await b.waitFor(`document.querySelector('[data-testid=dojo-squirrel]').hidden`, 15000, 100);
    const before = await shot();
    if (process.env.DUMP) { await Bun.write(`${import.meta.dir}/out/sqd-${state}-before.png`, Buffer.from(before, 'base64')); frames.forEach((f, i) => Bun.write(`${import.meta.dir}/out/sqd-${state}-${i}.png`, Buffer.from(f, 'base64'))); }

    // In the page: the frame edge per screen row (from the backdrop PNG, object-fit: cover), then per frame the pixels
    // that changed against `before` inside the squirrel's box, split by side of the edge.
    const r = await b.eval(`(async () => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
      const bd = px(await load(${JSON.stringify(BACKDROP)}));
      // The squirrel's own colours (its sprite strip): the drifting clouds and the blossom also change pixels near the
      // beam, so a wood-side change only counts when it turns into one of these.
      const st = px(await load('/ui/dojo/squirrel.png'));
      const pal = new Set(); for (let i = 0; i < st.data.length; i += 4) if (st.data[i + 3] > 200) pal.add((st.data[i] >> 3) + ',' + (st.data[i + 1] >> 3) + ',' + (st.data[i + 2] >> 3));
      const squirrelish = (d, i) => { for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) if (pal.has(((d[i] >> 3) + dr) + ',' + ((d[i + 1] >> 3) + dg) + ',' + ((d[i + 2] >> 3) + db))) return true; return false; };
      const wood = (x, y) => { const i = (y * bd.width + x) * 4; return bd.data[i] > bd.data[i + 2] + 10; };
      const edgeRow = (y) => { for (let x = 330; x < 460; x++) { let w = true; for (let k = 0; k < 6; k++) if (!wood(x + k, y)) { w = false; break; } if (w) return x; } return null; };
      const a = document.querySelector('.dojo-arena').getBoundingClientRect();
      const k = Math.max(a.width / 640, a.height / 360), ox = a.left + (a.width - 640 * k) / 2, oy = a.top + (a.height - 360 * k) / 2;
      // Nothing of the squirrel can draw outside its own box (overflow: hidden), so only the box is judged.
      const dpr = 2, cx = ${clip.x}, cy = ${clip.y}, boxRight = (${bx.r - 60} - cx) * dpr, boxLeft = (${bx.x + 20} - cx) * dpr;
      const ref = px(await load('data:image/png;base64,${before}'));
      const frames = ${JSON.stringify(frames)};
      // Judge only pixels where the bare backdrop shows in the reference frame (not the sign, its chains or the labels).
      const bare = (sx, sy) => { const bxp = Math.floor((cx + sx / dpr - ox) / k), byp = Math.floor((cy + sy / dpr - oy) / k); if (bxp < 0 || byp < 0 || bxp >= bd.width || byp >= bd.height) return false; const j = (byp * bd.width + bxp) * 4, i = (sy * ref.width + sx) * 4; return Math.abs(bd.data[j] - ref.data[i]) + Math.abs(bd.data[j + 1] - ref.data[i + 1]) + Math.abs(bd.data[j + 2] - ref.data[i + 2]) < 30; };
      let onWood = 0, outside = 0, worst = '', gap = Infinity;
      for (const f of frames) {
        const im = px(await load('data:image/png;base64,' + f));
        for (let sy = 0; sy < im.height; sy++) {
          const row = Math.floor((cy + sy / dpr - oy) / k); if (row < 22 || row > 83) continue;
          const e = edgeRow(row); if (e == null) continue;
          const edgeX = (ox + e * k - cx) * dpr;
          for (let sx = Math.max(0, Math.floor(boxLeft)); sx < Math.min(im.width, Math.ceil(boxRight)); sx++) {
            const i = (sy * im.width + sx) * 4;
            const d = Math.abs(im.data[i] - ref.data[i]) + Math.abs(im.data[i + 1] - ref.data[i + 1]) + Math.abs(im.data[i + 2] - ref.data[i + 2]);
            if (d < 60 || !bare(sx, sy)) continue;
            if (sx > edgeX + 2 * dpr) { if (!squirrelish(im.data, i)) continue; onWood++; if (!worst) worst = 'screen (' + Math.round(cx + sx / dpr) + ',' + Math.round(cy + sy / dpr) + ') vs edge ' + Math.round(cx + edgeX / dpr); }
            else { outside++; if (squirrelish(im.data, i)) gap = Math.min(gap, (edgeX - sx) / dpr); }
          }
        }
      }
      return { onWood, outside, worst, gap: Number.isFinite(gap) ? Math.round(gap * 10) / 10 : null };
    })()`) as { onWood: number; outside: number; worst: string; gap: number | null };
    ok(r.outside > 50, `${state}: the squirrel came out (${r.outside} changed px left of the frame)`);
    ok(r.onWood === 0, `${state}: never drawn over the frame or past it (${r.onWood} px${r.worst ? `, first at ${r.worst}` : ''})`);
    // It runs out from behind the wood: at some frame its visible part reaches the frame (not cut off in mid-air). On
    // the slanted beam the cut keeps one 2-art-px step of margin (≈ 4.5 css px at 2.25×), hence 6; mid-air was 18.5.
    ok(r.gap !== null && r.gap <= 6, `${state}: comes out right at the frame (closest ${r.gap ?? '—'} px from it)`);
  }
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
