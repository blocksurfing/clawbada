/**
 * Smoothness campaign (2026-10-30): record a battle as an MP4 for the before/after review page. Plays a mirror trio vs
 * the balanced bot on autoplay (like perf-battle.ts) and screencasts the page from the end of the intro.
 *
 *   WINDOW=1280,720 bash chrome-gpu.sh && CLASSES=mantis,leviathan SECONDS=25 LABEL=before BASE=http://127.0.0.1:3010 bun cdp.ts clip-battle.ts
 *   → out/clips/<LABEL>-<class>.mp4 (1280×720 window, 30 fps constant, frames timed from CDP's own timestamps)
 *
 * Needs ffmpeg on PATH. Muted (house rule); resigns through the API between classes.
 */
import type { Browser } from './cdp';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const CLASSES = (process.env.CLASSES ?? 'mantis').split(',').map((c) => c.trim()).filter(Boolean);
const ARENA = process.env.ARENA ?? 'elite';
const TIER = process.env.TIER ?? 'elite';
const SECONDS = Number(process.env.SECONDS ?? 25);
const LABEL = process.env.LABEL ?? 'clip';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  const OUT = `${import.meta.dir}/out/clips`;
  mkdirSync(OUT, { recursive: true });
  // The battle goes fullscreen, which in headless Chrome takes the WINDOW size: launch with WINDOW=1280,720.
  await b.send('Emulation.clearDeviceMetricsOverride');
  for (const cls of CLASSES) {
    await b.goto(`${BASE}/dojo?team=${cls},${cls},${cls}&tier=${TIER}&purity=6&bot=balanced&arena=${ARENA}&auto=1&stay=1`);
    if (!(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250))) { console.log(`${cls}: no Dojo`); continue; }
    await b.sleep(3000);
    const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    b.drainLogs();
    await b.clickAt(r.x, r.y);
    if (!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000))) { console.log(`${cls}: battle did not open`); continue; }
    const t0 = Date.now();
    while (Date.now() - t0 < 120000 && !b.logs.some((l) => /\[BattleStage\] intro complete/.test(l))) await b.sleep(250);

    const dir = `${OUT}/${LABEL}-${cls}-frames`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const frames: { file: string; ts: number }[] = [];
    const off = b.on('Page.screencastFrame', (p) => {
      const file = `${dir}/${String(frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(file, Buffer.from(p.data, 'base64'));
      frames.push({ file, ts: p.metadata.timestamp });
      void b.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    });
    await b.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
    await b.sleep(SECONDS * 1000);
    await b.send('Page.stopScreencast');
    off();

    // Variable-rate frames → constant 30 fps: each frame lasts until the next one arrived.
    frames.sort((a, c) => a.ts - c.ts);   // frames can arrive out of order
    const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.ts ?? f.ts + 1 / 30) - f.ts).toFixed(4)}`).join('\n');
    writeFileSync(`${dir}/list.txt`, `${list}\nfile '${frames[frames.length - 1]?.file}'\n`);
    const mp4 = `${OUT}/${LABEL}-${cls}.mp4`;
    const ff = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`,
      '-vf', 'crop=iw:trunc(iw*9/16/2)*2,fps=30,scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4]);
    console.log(`${cls}: ${frames.length} frames over ${SECONDS} s → ${ff.exitCode === 0 ? mp4 : 'ffmpeg failed: ' + ff.stderr.toString().slice(0, 200)}`);
    rmSync(dir, { recursive: true, force: true });

    const resigned = await b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 'no session'; const r = await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }); return r.status; })()`);
    if (resigned !== 200 && resigned !== 404) console.log(`${cls}: forfeit -> ${resigned}`);
  }
}
