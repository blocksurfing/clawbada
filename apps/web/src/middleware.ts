import { NextResponse, type NextRequest } from 'next/server';
import { COMING_SOON_GATE, COMING_SOON_PATH, isOpenPath } from './lib/site-gate';

/**
 * The Coming Soon gate (lib/site-gate.ts). Gated pages are REWRITTEN to /coming-soon, so the address a visitor typed
 * stays in the bar. The docs host's own pages are rewritten to /book by next.config.ts (after this runs) and pass.
 */
const DOCS_PATHS = new Set(['/', '/index.html', '/pdf', '/Clawbada-Gitbook.pdf']);

export function middleware(req: NextRequest) {
  if (!COMING_SOON_GATE) return NextResponse.next();
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;
  // The docs host's own pages (rewritten to /book by next.config.ts); its other paths fall through to the app — gated.
  if (host.startsWith('docs.') && DOCS_PATHS.has(pathname)) return NextResponse.next();
  if (isOpenPath(pathname)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = COMING_SOON_PATH;
  url.search = '';
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: never Next's own files, the API-less app's static folders, or any file with an extension (art, audio,
  // the Unity build, icons, robots.txt…).
  matcher: ['/((?!_next/|ui/|assets/|audio/|unity-build/|data/|loading/|marketing/|book/|.*\\.[a-zA-Z0-9]+$).*)'],
};
