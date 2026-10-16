#!/usr/bin/env bun
/**
 * The Clawbada book, in Nzib's Market look.
 *
 *   docs/gitbook/*.md  (order = docs/gitbook/SUMMARY.md)
 *     → docs/gitbook/gitbook-combined.md   a clean single-file Markdown copy (GitHub renders it)
 *     → docs/Clawbada-Gitbook.html         ONE self-contained file: fonts and art embedded as data: URIs
 *     → docs/Clawbada-Gitbook.pdf          the HTML printed by headless Chrome (A4, backgrounds on)
 *
 * Run it through `bash scripts/build-gitbook.sh` (which checks the tools). Needs pandoc, bun and Google
 * Chrome (CHROME_BIN overrides the path). The art and the type tokens come straight from the website
 * (apps/web/public/ui/*, apps/web/src/fonts/upheaval, apps/web/src/components/chrome/chrome.css), so the
 * book cannot drift from the Market page. Body copy is Titillium Web (SIL OFL, scripts/gitbook/fonts) —
 * the owner's "hybrid" choice: pixel headings, regular text for long reading. Big Shot is deliberately
 * NOT embedded until its licence is confirmed with Nzib.
 *
 * Options: BOOK_DATE="October 2026" pins the cover date; SKIP_PDF=1 stops after the HTML.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../..');
const GITBOOK = join(REPO, 'docs/gitbook');
const PUBLIC = join(REPO, 'apps/web/public');
const OUT_MD = join(GITBOOK, 'gitbook-combined.md');
const OUT_HTML = join(REPO, 'docs/Clawbada-Gitbook.html');
const OUT_PDF = join(REPO, 'docs/Clawbada-Gitbook.pdf');

const BOOK = {
  title: 'Clawbada',
  subtitle: 'Idle or tactical. Agent or human. Same rules, real stakes.',
  author: 'Clawbada Team',
  date: process.env.BOOK_DATE ?? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date()),
};

/** The display scale every pixel surface uses (`--pixel: 3px` in chrome.css). */
const PIXEL = 3;

/** Class order = the game's class index (packages/game-logic CLASS_NAMES_LIST) = the badge sheet's frame order. */
const CLASSES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
/** Tier order = evolution tier = Tileset symbol frames 35–38. */
const TIERS = ['Base', 'Evolved', 'Elite', 'Apex'];

// ──────────── helpers ────────────

const log = (msg: string) => console.log(`>> ${msg}`);
const fail = (msg: string): never => { console.error(`!! ${msg}`); process.exit(1); };

function dataUri(path: string, mime: string): string {
  if (!existsSync(path)) fail(`missing asset ${path}`);
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────── 1. chapters, in SUMMARY order ────────────

interface Chapter { title: string; file: string; slug: string; markdown: string; html: string; h1: string; sections: { id: string; text: string }[] }

function readSummary(): Pick<Chapter, 'title' | 'file' | 'slug'>[] {
  const summary = readFileSync(join(GITBOOK, 'SUMMARY.md'), 'utf8');
  const chapters = [...summary.matchAll(/^\*\s+\[(.+?)\]\((.+?\.md)\)\s*$/gm)].map((m) => ({
    title: m[1], file: m[2], slug: basename(m[2], '.md').toLowerCase(),
  }));
  if (chapters.length === 0) fail('SUMMARY.md lists no chapters');
  for (const c of chapters) if (!existsSync(join(GITBOOK, c.file))) fail(`SUMMARY.md names ${c.file}, which does not exist`);
  return chapters;
}

/** pandoc, one chapter at a time: `--id-prefix` keeps heading ids unique across chapters and rewrites in-chapter links. */
function renderChapter(file: string, slug: string): string {
  const proc = Bun.spawnSync([
    'pandoc', join(GITBOOK, file),
    '-f', 'gfm-tex_math_dollars-tex_math_gfm', // $GOLD and $ prices are never math
    '-t', 'html5', '--wrap=none', '--syntax-highlighting=none', `--id-prefix=${slug}-`,
  ]);
  if (proc.exitCode !== 0) fail(`pandoc failed on ${file}:\n${proc.stderr.toString()}`);
  return proc.stdout.toString();
}

/** `other.md` → `#other`, `other.md#anchor` → `#other-anchor` (pandoc has already prefixed the anchor's id). */
function rewriteCrossLinks(html: string, slugs: Set<string>, file: string): string {
  return html.replace(/href="([A-Za-z0-9_-]+)\.md(?:#([^"]+))?"/g, (_m, target: string, anchor?: string) => {
    const slug = target.toLowerCase();
    if (!slugs.has(slug)) fail(`${file} links to ${target}.md, which is not a chapter`);
    return `href="#${anchor ? `${slug}-${anchor}` : slug}"`;
  });
}

/** Class and tier names in a table row's first cell get the Market's badge / tier symbol in front of them. */
function decorateTables(html: string): string {
  return html.replace(/<tr>(\s*)<td([^>]*)>([\s\S]*?)<\/td>/g, (m, ws: string, attrs: string, inner: string) => {
    const text = stripTags(inner);
    const classIdx = CLASSES.indexOf(text);
    const tierIdx = TIERS.indexOf(text);
    if (classIdx === -1 && tierIdx === -1) return m;
    const icon = classIdx !== -1
      ? `<span class="icon badge badge-${classIdx}" aria-hidden="true"></span>`
      : `<span class="icon tier tier-${tierIdx}" aria-hidden="true"></span>`;
    return `<tr>${ws}<td${attrs} class="has-icon">${icon}<span class="icon-label">${inner}</span></td>`;
  });
}

function headings(html: string): { h1: string; sections: { id: string; text: string }[] } {
  let h1 = '';
  const sections: { id: string; text: string }[] = [];
  for (const m of html.matchAll(/<h([12]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    if (m[1] === '1' && !h1) h1 = m[3];
    else if (m[1] === '2') sections.push({ id: m[2], text: m[3] });
  }
  return { h1, sections };
}

// ──────────── 2. art, cropped from the live sheets ────────────

/** sharp is a workspace dependency of @clawbada/asset-gen; bun keeps it there, so resolve it from that package. */
async function loadSharp(): Promise<any> {
  try {
    const path = Bun.resolveSync('sharp', join(REPO, 'packages/asset-gen'));
    return (await import(path)).default;
  } catch (e) {
    return fail(`sharp is not installed (run bun install at the repo root): ${(e as Error).message}`);
  }
}

/** A region of a sheet, upscaled ×3 nearest-neighbour so border-image stays pixel-crisp. */
async function crop(sharp: any, sheet: string, left: number, top: number, width: number, height: number): Promise<string> {
  const buf: Buffer = await sharp(join(PUBLIC, sheet))
    .extract({ left, top, width, height })
    .resize(width * PIXEL, height * PIXEL, { kernel: 'nearest' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ──────────── 3. the page ────────────

function tocHtml(chapters: Chapter[]): string {
  return chapters.map((c, i) => `
      <li><a class="toc-chapter" href="#${c.slug}"><span class="toc-n">${String(i + 1).padStart(2, '0')}</span>${c.h1 || escapeHtml(c.title)}</a>
        ${c.sections.length ? `<ul>${c.sections.map((s) => `<li><a href="#${s.id}">${s.text}</a></li>`).join('')}</ul>` : ''}
      </li>`).join('');
}

function coverHtml(): string {
  const badges = CLASSES.map((name, i) => `<span class="icon badge badge-${i} badge-lg" role="img" aria-label="${name}" title="${name}"></span>`).join('');
  return `
    <header class="cover">
      <img class="cover-logo" src="{{logo}}" width="512" height="512" alt="Clawbada" />
      <p class="cover-subtitle">${escapeHtml(BOOK.subtitle)}</p>
      <p class="cover-badges" aria-label="The ten lobster classes">${badges}</p>
      <p class="cover-meta">${escapeHtml(BOOK.author)} · ${escapeHtml(BOOK.date)} · <span class="icon coin" aria-hidden="true"></span>$GOLD on Base</p>
    </header>`;
}

function assertIntegrity(html: string, chapters: Chapter[]): void {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const broken = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  if (broken.length) fail(`${broken.length} internal links point nowhere: ${[...new Set(broken)].slice(0, 8).join(', ')}`);
  for (const leftover of ['\\$', '$\\to$', '\\newpage', '{%']) {
    if (html.includes(leftover)) fail(`the HTML still contains "${leftover}"`);
  }
  const sectionsFound = chapters.filter((c) => html.includes(`<section class="chapter" id="${c.slug}">`)).length;
  if (sectionsFound !== chapters.length) fail(`${sectionsFound} of ${chapters.length} chapter sections made it into the page`);
  const tables = (html.match(/<table>/g) ?? []).length;
  const pres = (html.match(/<pre>/g) ?? []).length;
  log(`integrity: ${chapters.length} chapters, ${tables} tables, ${pres} code blocks, ${ids.size} ids, every internal link resolves`);
}

// ──────────── 4. print through DevTools ────────────

function findChrome(): string {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    Bun.which('google-chrome'), Bun.which('google-chrome-stable'), Bun.which('chromium'), Bun.which('chromium-browser'),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  return found ?? fail('no Chrome found — set CHROME_BIN');
}

async function printPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const chrome = findChrome();
  const port = Number(process.env.BOOK_CDP_PORT ?? 9333);
  const profile = mkdtempSync(join(tmpdir(), 'clawbada-book-'));
  const proc = Bun.spawn([
    chrome, '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdout: 'ignore', stderr: 'ignore' });
  try {
    let wsUrl = '';
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl?: string }[];
        wsUrl = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? '';
      } catch { /* not up yet */ }
      if (!wsUrl) await Bun.sleep(250);
    }
    if (!wsUrl) fail(`Chrome did not expose a page on :${port}`);

    const ws = new WebSocket(wsUrl);
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    let loaded = false;
    let nextId = 1;
    await new Promise<void>((res, rej) => { ws.addEventListener('open', () => res(), { once: true }); ws.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true }); });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      } else if (msg.method === 'Page.loadEventFired') loaded = true;
    });
    const send = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => {
      const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 120_000);
    });

    const t0 = Date.now();
    const lap = (what: string) => log(`chrome: ${what} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await send('Page.enable');
    await send('Page.navigate', { url: `file://${htmlPath}` });
    for (let i = 0; i < 600 && !loaded; i++) await Bun.sleep(100);
    if (!loaded) fail('the book did not finish loading in Chrome');
    lap('page loaded');
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => document.fonts.size)', awaitPromise: true, returnByValue: true });
    await Bun.sleep(300); // let border-images decode
    lap('fonts ready');
    const { data } = await send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, transferMode: 'ReturnAsBase64',
    });
    lap('printed');
    writeFileSync(pdfPath, Buffer.from(data, 'base64'));
    ws.close();
  } finally {
    proc.kill();
    rmSync(profile, { recursive: true, force: true });
  }
}

// ──────────── main ────────────

if (!Bun.which('pandoc')) fail('pandoc is not installed');

const order = readSummary();
const slugs = new Set(order.map((c) => c.slug));
const chapters: Chapter[] = order.map((c) => {
  const markdown = readFileSync(join(GITBOOK, c.file), 'utf8');
  let html = renderChapter(c.file, c.slug);
  html = rewriteCrossLinks(html, slugs, c.file);
  html = decorateTables(html);
  const { h1, sections } = headings(html);
  return { ...c, markdown, html, h1, sections };
});
log(`${chapters.length} chapters: ${chapters.map((c) => c.slug).join(' · ')}`);

// The clean single-file Markdown copy.
const frontmatter = `---\ntitle: "${BOOK.title}"\nsubtitle: "${BOOK.subtitle}"\nauthor: "${BOOK.author}"\ndate: "${BOOK.date}"\n---\n\n`;
writeFileSync(OUT_MD, frontmatter + chapters.map((c) => c.markdown.trimEnd() + '\n').join('\n'));
log(`combined markdown written: ${OUT_MD}`);

const sharp = await loadSharp();
const assets: Record<string, string> = {
  upheaval: dataUri(join(REPO, 'apps/web/src/fonts/upheaval/upheavtt.ttf'), 'font/ttf'),
  titilliumRegular: dataUri(join(import.meta.dir, 'fonts/TitilliumWeb-Regular.ttf'), 'font/ttf'),
  titilliumItalic: dataUri(join(import.meta.dir, 'fonts/TitilliumWeb-Italic.ttf'), 'font/ttf'),
  titilliumSemiBold: dataUri(join(import.meta.dir, 'fonts/TitilliumWeb-SemiBold.ttf'), 'font/ttf'),
  titilliumBold: dataUri(join(import.meta.dir, 'fonts/TitilliumWeb-Bold.ttf'), 'font/ttf'),
  logo: dataUri(join(PUBLIC, 'ui/brand/logo-wordmark-512.png'), 'image/png'),
  badges: dataUri(join(PUBLIC, 'ui/shell/class-badges.png'), 'image/png'),   // 160×16, frame = class
  tileset: dataUri(join(PUBLIC, 'ui/market/Tileset.png'), 'image/png'),      // 208×128, 16×16 symbols
  icons: dataUri(join(PUBLIC, 'ui/sidebar/Icons.png'), 'image/png'),         // 192×16, frame 8 = coin
  wood: await crop(sharp, 'ui/tileset/WoodenPanel.png', 0, 0, 48, 48),      // the Shell/Market wooden panel
  divider: await crop(sharp, 'ui/market/Tileset.png', 96, 64, 96, 16),       // the card divider strip
};

const css = readFileSync(join(import.meta.dir, 'book.css'), 'utf8');
const template = readFileSync(join(import.meta.dir, 'template.html'), 'utf8');
const body = chapters.map((c) => `<section class="chapter" id="${c.slug}">\n${c.html}\n</section>`).join('\n');
const vars: Record<string, string> = {
  title: escapeHtml(BOOK.title),
  subtitle: escapeHtml(BOOK.subtitle),
  description: escapeHtml(`${BOOK.title} — ${BOOK.subtitle} (${BOOK.date})`),
  css,
  fontUpheaval: assets.upheaval, fontTitilliumRegular: assets.titilliumRegular, fontTitilliumItalic: assets.titilliumItalic,
  fontTitilliumSemiBold: assets.titilliumSemiBold, fontTitilliumBold: assets.titilliumBold,
  logo: assets.logo, badges: assets.badges, tileset: assets.tileset, icons: assets.icons, wood: assets.wood, divider: assets.divider,
  cover: coverHtml(),
  toc: tocHtml(chapters),
  body,
  date: escapeHtml(BOOK.date),
};
let page = template;
for (let pass = 0; pass < 2; pass++) { // the cover carries a {{logo}} of its own
  page = page.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in vars ? vars[key] : m));
}
const unfilled = page.match(/\{\{\w+\}\}/g);
if (unfilled) fail(`template placeholders left unfilled: ${[...new Set(unfilled)].join(', ')}`);

assertIntegrity(page, chapters);
writeFileSync(OUT_HTML, page);
log(`HTML written: ${OUT_HTML} (${(page.length / 1024).toFixed(0)} KB)`);

if (process.env.SKIP_PDF) { log('SKIP_PDF set — no PDF'); process.exit(0); }
await printPdf(OUT_HTML, OUT_PDF);
log(`PDF written: ${OUT_PDF} (${(Bun.file(OUT_PDF).size / 1024).toFixed(0)} KB)`);
