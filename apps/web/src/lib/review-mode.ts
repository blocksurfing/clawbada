/**
 * Review tools — autoplay (`?auto=1`, `?auto=special`, `?autodelay=`), playback speed (`?speed=`), stay-open
 * (`?stay=1`) and the performance overlay (`?perf=1`) — are for the test harness and for the designers' VFX passes.
 *
 * They change how a battle plays for whoever has the page open, so a link must not be able to switch them on for
 * somebody else: an invite link carrying `?auto=1` used to make the friend's browser play their turns for them. They
 * now work only in a browser that has opted in LOCALLY, which no link can do:
 *
 *     localStorage.setItem('clawbada.review', '1')      // once, in the browser console; '0' or removeItem turns it off
 *
 * The harness sets it for every probe (scripts/harness/cdp.ts). A development build is always in review mode.
 */
export const REVIEW_FLAG = 'clawbada.review';

/** The query parameters that are review tools. Nothing else in the URL is affected. */
export const REVIEW_KEYS = ['auto', 'autodelay', 'speed', 'stay', 'perf'] as const;

interface FlagStore { getItem(key: string): string | null }

/** Has this browser opted in? `store` and `production` are injectable for the test. */
export function reviewModeOn(
  store: FlagStore | undefined = typeof window === 'undefined' ? undefined : window.localStorage,
  production: boolean = process.env.NODE_ENV === 'production',
): boolean {
  if (!production) return true;
  try {
    return store?.getItem(REVIEW_FLAG) === '1';
  } catch {
    return false;   // storage blocked: not opted in
  }
}

/**
 * The review parameters of a query string — all of them when this browser is in review mode, none otherwise.
 * Read every review parameter through this (never `location.search` directly), and carry them from page to page
 * with it, so an opted-out browser neither obeys nor forwards them.
 */
export function reviewParams(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  on: boolean = reviewModeOn(),
): URLSearchParams {
  const out = new URLSearchParams();
  if (!on) return out;
  const q = new URLSearchParams(search);
  for (const k of REVIEW_KEYS) {
    const v = q.get(k);
    if (v) out.set(k, v);
  }
  return out;
}
