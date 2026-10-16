/**
 * The Clawbada book (docs/Clawbada-Gitbook.html) in Nzib's Market look — a structural check of the built page.
 *
 *   bash chrome-restart.sh && bun cdp.ts gitbook-probe.ts            # BOOK=/abs/path.html overrides the file
 *
 * Checks: the ten chapter panels exist and paint their wooden border-image; headings and TOC entries compute as
 * Upheaval, paragraphs and table cells as Titillium Web; every internal link resolves; the class tables carry
 * badge sprites with a resolved background image; no horizontal overflow at 1440 and 900; the print stylesheet
 * declares the per-page frame. Frames: out/gitbook-{cover,toc,chapter,table,code,narrow}.png.
 */
import type { Browser } from './cdp';

const TAG = 'gitbook';
const BOOK = process.env.BOOK ?? `${import.meta.dir}/../../docs/Clawbada-Gitbook.html`;
const S = `${import.meta.dir}/out`;
let ok = true;
const fail = (m: string) => { ok = false; console.log('[gitbook-fail]', m); };
const shot = async (b: Browser, name: string) => { await b.screenshot(`${S}/${TAG}-${name}.png`); };

export default async function (b: Browser) {
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await b.goto(`file://${BOOK}`);
  await b.waitFor(`document.fonts.status === 'loaded' && document.querySelectorAll('section.chapter').length > 0`, 15000, 100);
  await b.sleep(500);

  const summary = await b.eval(`(() => {
    const fam = (el) => el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null;
    const chapters = [...document.querySelectorAll('section.chapter')];
    const painted = chapters.filter((c) => getComputedStyle(c).borderImageSource.startsWith('url(')).length;
    const ids = new Set([...document.querySelectorAll('[id]')].map((e) => e.id));
    const links = [...document.querySelectorAll('a[href^="#"]')];
    const broken = links.filter((a) => !ids.has(decodeURIComponent(a.getAttribute('href').slice(1)))).map((a) => a.getAttribute('href'));
    const badge = document.querySelector('td .badge');
    const tier = document.querySelector('td .tier');
    const sheet = [...document.styleSheets].find((s) => !s.href);
    const rules = sheet ? [...sheet.cssRules].map((r) => r.cssText).join('\\n') : '';
    return {
      chapters: chapters.length, painted, h1: fam(document.querySelector('.chapter h1')), h2: fam(document.querySelector('.chapter h2')),
      h4: fam(document.querySelector('.chapter h4')), toc: fam(document.querySelector('.toc-chapter')), p: fam(document.querySelector('.chapter p')),
      td: fam(document.querySelector('.chapter td')), th: fam(document.querySelector('.chapter th')), code: fam(document.querySelector('pre')),
      badges: document.querySelectorAll('td .badge').length, tiers: document.querySelectorAll('td .tier').length,
      badgeImg: badge ? getComputedStyle(badge).backgroundImage.startsWith('url(') : false,
      tierImg: tier ? getComputedStyle(tier).backgroundImage.startsWith('url(') : false,
      links: links.length, broken: broken.slice(0, 5), tables: document.querySelectorAll('table').length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      printFrame: /@media print[\\s\\S]*\\.print-frame[\\s\\S]*position: fixed/.test(rules), pageRule: /@page/.test(rules),
      coverLogo: (() => { const i = document.querySelector('.cover-logo'); return i ? { w: i.getBoundingClientRect().width, loaded: i.complete && i.naturalWidth > 0 } : null; })(),
      coverBadges: document.querySelectorAll('.cover-badges .badge').length,
    };
  })()`);
  console.log('[gitbook-log]', JSON.stringify(summary));
  if (summary.chapters !== 10) fail(`${summary.chapters} chapters (expected 10)`);
  if (summary.painted !== summary.chapters) fail(`${summary.painted} of ${summary.chapters} chapter panels paint the wooden border`);
  for (const k of ['h1', 'h2', 'h4', 'toc', 'th']) if (summary[k] !== 'Upheaval') fail(`${k} font is ${summary[k]}, expected Upheaval`);
  for (const k of ['p', 'td']) if (summary[k] !== 'Titillium Web') fail(`${k} font is ${summary[k]}, expected Titillium Web`);
  if (summary.broken.length) fail(`broken internal links: ${summary.broken.join(', ')}`);
  if (summary.badges < 10 || !summary.badgeImg) fail(`class badges in tables: ${summary.badges}, image resolved ${summary.badgeImg}`);
  if (summary.tiers < 4 || !summary.tierImg) fail(`tier symbols in tables: ${summary.tiers}, image resolved ${summary.tierImg}`);
  if (summary.overflow) fail('horizontal overflow at 1440');
  if (!summary.printFrame || !summary.pageRule) fail('print rules missing (per-page frame / @page)');
  if (!summary.coverLogo?.loaded || Math.round(summary.coverLogo.w) !== 512) fail(`cover logo ${JSON.stringify(summary.coverLogo)}`);
  if (summary.coverBadges !== 10) fail(`cover shows ${summary.coverBadges} class badges`);
  await shot(b, 'cover');

  const scrollTo = async (sel: string) => { await b.eval(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'start' })`); await b.sleep(300); };
  await scrollTo('.toc'); await shot(b, 'toc');
  await scrollTo('#battle'); await shot(b, 'chapter');
  await scrollTo('td .badge'); await b.eval(`window.scrollBy(0, -120)`); await b.sleep(200); await shot(b, 'table');
  await scrollTo('pre'); await b.eval(`window.scrollBy(0, -160)`); await b.sleep(200); await shot(b, 'code');

  await b.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
  await b.sleep(400);
  const narrow = await b.eval(`({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, widestTable: Math.max(...[...document.querySelectorAll('table')].map((t) => t.getBoundingClientRect().width)) })`);
  if (narrow.overflow) fail(`horizontal overflow at 900 (widest table ${narrow.widestTable}px)`);
  await b.eval(`window.scrollTo(0, 0)`); await b.sleep(200);
  await shot(b, 'narrow');
  await b.send('Emulation.clearDeviceMetricsOverride', {});

  console.log(`[gitbook] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/${TAG}-{cover,toc,chapter,table,code,narrow}.png`);
}
