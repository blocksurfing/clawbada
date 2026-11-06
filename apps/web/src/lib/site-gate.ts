/**
 * The public entry gate (Nzib's Coming Soon page, design/website e35532b; owner 2026-11-06: "Dojo only"). While it is on,
 * every page shows Coming Soon except the Dojo and what a Dojo battle needs: the battle page and the friend-invite
 * link. The docs host and static files are never gated. Menus keep every page (owner 2026-11-06): a gated link simply
 * opens Coming Soon. Flip COMING_SOON_GATE to false (and deploy) to open the site.
 */
export const COMING_SOON_GATE = true;

export const COMING_SOON_PATH = '/coming-soon';

/** Page paths that stay reachable while the gate is on. */
const OPEN = [/^\/dojo(\/|$)/, /^\/battle\//, /^\/battle-friends(\/|$)/, /^\/coming-soon(\/|$)/, /^\/book(\/|$)/];

/** True when `pathname` is served as itself under the gate (pages only — the middleware never sees static files). */
export function isOpenPath(pathname: string): boolean {
  return OPEN.some((re) => re.test(pathname));
}
