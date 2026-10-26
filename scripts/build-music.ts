/**
 * Encode arena music masters into the web app as content-hashed AAC and generate the
 * lookup React imports at build time.
 *
 *   bun scripts/build-music.ts                 # masters from audio-masters/music/
 *   bun scripts/build-music.ts --in <dir>      # elsewhere
 *   bun scripts/build-music.ts --bitrate 160k  # default 128k
 *
 * Why this shape:
 *  - Music is NOT in the Unity bundle: it is served as its own file and streamed by an
 *    HTML5 <audio> element from React, like the landing-page theme. The bundle stays small,
 *    only the arena you enter is downloaded, and it starts within a second.
 *  - The filename carries a content hash, so /audio/music/* can be cached as immutable for a
 *    year and still invalidate the moment a track changes. The mapping is baked into a
 *    generated TS module (itself hashed by Next), so there is no runtime manifest fetch.
 *  - AAC (m4a), not OGG: URL-loaded audio is decoded by the browser, and Safari cannot decode
 *    Vorbis. Apple's encoder (aac_at) is used when ffmpeg has it, else ffmpeg's own.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const root = resolve(import.meta.dir, '..');
const inDir = resolve(opt('in', join(root, 'audio-masters/music')));
const bitrate = opt('bitrate', '128k');
const outDir = join(root, 'apps/web/public/audio/music');
const genPath = join(root, 'apps/web/src/lib/arena-music.generated.ts');
const TIERS = ['evolved', 'elite', 'apex', 'dojo'] as const;
/** Boards without a master of their own borrow another board's track until one arrives. A board may have several
 *  masters — `BGM_Arena_<Tier>.wav` and/or numbered `BGM_Arena_<Tier>_01.wav`, `_02` … — and each battle picks one
 *  (arena-music.ts; owner 2026-10-25: two Dojo tracks, one per battle at random). */
const FALLBACK: Partial<Record<(typeof TIERS)[number], (typeof TIERS)[number]>> = { dojo: 'evolved' };
/** The breeze under the web loading loop (apps/web/src/lib/entry-ambience.ts). A PLACEHOLDER name until the master
 *  exists: drop `AMB_Loading_Breeze.wav` in the masters folder and re-run; until then ENTRY_AMBIENCE is null (silent). */
const AMBIENCE = 'AMB_Loading_Breeze';
/** Make-up gain (dB) applied while encoding, for masters delivered far quieter than the rest of the site. The breeze
 *  master measures −52 dB mean / −35.5 dB peak against the theme's −15 / 0 — playing at gain 0.95 it was inaudible
 *  (owner 2026-10-24: "the wind audio does not play at all"). +24 dB puts it at ~−28 dB mean, under the theme as an
 *  ambience bed, peak ~−11.5 dB (no clipping). The master itself is left untouched. */
const GAIN_DB: Record<string, number> = { [AMBIENCE]: 24 };
/** A built track averaging below this is treated as a mastering mistake: the build stops instead of shipping silence. */
const MIN_MEAN_DB = -40;
/**
 * The ambience loops (entry-ambience.ts, `loop = true`), so its file must end exactly where it begins:
 *   · the last LOOP_XFADE_S of the master cross-fades (equal power) into its first LOOP_XFADE_S — no seam;
 *   · the result is cut to a whole number of 1024-sample AAC frames, so the encoder adds no padding at the end;
 *   · two 80 Hz high-passes (24 dB/octave) take out the mic-buffeting puffs (9.8–13.1 s of the breeze master) that
 *     the make-up gain had made audible as a low rumble. The wind's body (120 Hz–2 kHz) is untouched.
 */
const LOOP_XFADE_S = 1;
function seamlessLoopFilter(path: string, gainDb: number): string {
  const probe = new TextDecoder().decode(Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=sample_rate,duration_ts', '-of', 'default=nw=1', path]).stdout);
  const rate = Number(/sample_rate=(\d+)/.exec(probe)?.[1]), samples = Number(/duration_ts=(\d+)/.exec(probe)?.[1]);
  if (!rate || !samples) { console.error(`ffprobe could not read ${path}`); process.exit(1); }
  const frames = Math.floor((samples - LOOP_XFADE_S * rate) / 1024) * 1024;
  return `[0:a]highpass=f=80,highpass=f=80${gainDb ? `,volume=${gainDb}dB` : ''},asplit[a][b];`
    + `[a]atrim=start=${LOOP_XFADE_S},asetpts=PTS-STARTPTS[body];[b]atrim=end=${LOOP_XFADE_S},asetpts=PTS-STARTPTS[head];`
    + `[body][head]acrossfade=d=${LOOP_XFADE_S}:c1=qsin:c2=qsin,atrim=end_sample=${frames}`;
}
const MASTER = /^(BGM_Arena_(Evolved|Elite|Apex|Dojo)(_\d{2})?|AMB_Loading_Breeze)\.wav$/i;
const BUILT = /^(BGM_Arena_(Evolved|Elite|Apex|Dojo)(_\d{2})?|AMB_Loading_Breeze)\.[0-9a-f]{8}\.m4a$/;

mkdirSync(outDir, { recursive: true });
const masters = existsSync(inDir) ? readdirSync(inDir).filter((f) => MASTER.test(f)).sort() : [];
if (masters.length === 0) { console.error(`no BGM_Arena_<Tier>.wav masters in ${inDir}`); process.exit(1); }

const urls: Record<string, string[]> = { evolved: [], elite: [], apex: [], dojo: [] };
let ambience: string | null = null;
const keep = new Set<string>();
for (const file of masters) {
  const stem = basename(file, '.wav');
  const tier = stem.toLowerCase() === AMBIENCE.toLowerCase() ? null : stem.split('_')[2].toLowerCase();
  const tmp = join(outDir, `.${basename(file, '.wav')}.tmp.m4a`);
  const gain = GAIN_DB[stem] ?? 0;
  const loop = tier === null ? seamlessLoopFilter(join(inDir, file), gain) : null;
  const filter = loop ? ['-filter_complex', loop] : gain ? ['-af', `volume=${gain}dB`] : [];
  const enc = (codec: string) => Bun.spawnSync(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', join(inDir, file),
    '-vn', ...filter, '-c:a', codec, '-b:a', bitrate, '-movflags', '+faststart', tmp]);
  // The looping ambience uses ffmpeg's own AAC: Apple's (aac_at) pads ~22 ms of silence onto the end, which a looping
  // <audio> plays as a dropout every pass (owner 2026-10-25: "some little mechanical sound at times").
  let r = enc(loop ? 'aac' : 'aac_at');
  if (r.exitCode !== 0 && !loop) r = enc('aac');
  if (r.exitCode !== 0) { console.error(`ffmpeg failed for ${file}:\n${new TextDecoder().decode(r.stderr)}`); process.exit(1); }
  const level = new TextDecoder().decode(Bun.spawnSync(['ffmpeg', '-hide_banner', '-nostats', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-']).stderr);
  const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(level)?.[1] ?? NaN), peak = Number(/max_volume: (-?[\d.]+) dB/.exec(level)?.[1] ?? NaN);
  if (!(mean >= MIN_MEAN_DB)) { console.error(`${file}: built track averages ${mean} dB (peak ${peak} dB) — below ${MIN_MEAN_DB} dB, it would be inaudible. Fix the master or add make-up gain in GAIN_DB.`); process.exit(1); }
  const bytes = readFileSync(tmp);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${basename(file, '.wav')}.${hash}.m4a`;
  rmSync(join(outDir, name), { force: true });
  Bun.spawnSync(['mv', tmp, join(outDir, name)]);
  keep.add(name);
  if (tier) urls[tier].push(`/audio/music/${name}`);
  else ambience = `/audio/music/${name}`;
  console.log(`${file} → ${name}  ${(bytes.length / 1048576).toFixed(2)} MB @ ${bitrate}, mean ${mean} dB / peak ${peak} dB${gain ? ` (+${gain} dB make-up)` : ''}`);
}
if (!ambience) console.log(`no ${AMBIENCE}.wav master yet — ENTRY_AMBIENCE stays null (the battle entry is silent)`);
// Drop stale hashed variants of the same tracks so the folder only holds what the app references.
for (const f of readdirSync(outDir)) if (BUILT.test(f) && !keep.has(f)) { rmSync(join(outDir, f)); console.log(`removed stale ${f}`); }

const body = TIERS.map((t) => {
  const alias = urls[t].length === 0 && FALLBACK[t];
  const list = urls[t].length ? urls[t] : alias ? urls[alias] : [];
  return `  ${t}: ${JSON.stringify(list)},${alias && list.length ? `   // no ${t} master yet: the ${alias} track stands in` : ''}`;
}).join('\n');
writeFileSync(genPath, `// GENERATED by scripts/build-music.ts — do not edit. Re-run after changing a master.
export type ArenaTier = ${TIERS.map((t) => `'${t}'`).join(' | ')};
/** Content-hashed URLs, served immutable from public/audio/music/. Each battle plays one of its tier's tracks
 *  (arena-music.ts picks by battle id); an empty list = no track for that tier. */
export const ARENA_MUSIC: Record<ArenaTier, readonly string[]> = {
${body}
};
/** The breeze under the web loading loop (lib/entry-ambience.ts). null = no ${AMBIENCE}.wav master yet: the entry is silent. */
export const ENTRY_AMBIENCE: string | null = ${ambience ? JSON.stringify(ambience) : 'null'};
`);
console.log(`wrote ${genPath.replace(root + '/', '')}`);
