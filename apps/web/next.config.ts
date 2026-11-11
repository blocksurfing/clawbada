import type { NextConfig } from 'next';

/** The book's hostname: the sidebar's Docs link, and the Vercel domain on this project. */
const DOCS_HOST = 'docs.clawbada.com';

/**
 * Sent with every page and file.
 *   - No other site may put the game in a frame (clickjacking: a page that draws its own buttons over ours). Both
 *     spellings, for old and new browsers. The Base App mini-app will need an allowance here when it is built.
 *   - base-uri / object-src / form-action: three things the app never does, switched off. Scripts are NOT restricted
 *     yet — Unity (WebAssembly) and the wallet connectors need a policy written and tested against them.
 *   - nosniff: a file is what its Content-Type says. Referrer: other sites learn the origin, never the path.
 *   - Permissions: the game uses no camera, microphone or location (fullscreen is left alone — battles use it).
 * Not set on purpose: Cross-Origin-Opener-Policy — wallet pop-ups talk to the page that opened them.
 */
export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@clawbada/game-logic', '@clawbada/chain'],
  // Unity WebGL build (gitignored; built locally via BuildScript.BuildWebGL). The build uses
  // Brotli WITH Unity's decompression fallback, so the compressed artifacts are `*.unityweb`
  // and the loader inflates them itself — no Content-Encoding/Content-Type headers required.
  async headers() {
    return [
      // Every response. First in the list: a later entry that sets the same header for its own paths wins.
      { source: '/:path*', headers: SECURITY_HEADERS },
      { source: '/unity-build/Build/:file*.unityweb', headers: [{ key: 'Content-Type', value: 'application/octet-stream' }] },
      // Arena music is content-hashed by scripts/build-music.ts (BGM_Arena_<Tier>.<sha8>.m4a), so it can be
      // cached for a year and still invalidate the moment a track changes — independent of Unity rebuilds.
      { source: '/audio/music/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      // The site's UI sounds, content-hashed the same way by scripts/build-sfx.ts (SFX_UI_<Name>.<sha8>.m4a).
      { source: '/audio/sfx/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      // Battle Friends invites carry their secret in the URL fragment (never sent to a server); the join page also sends
      // no Referer at all, so nothing it loads or links to can learn where the player came from.
      { source: '/battle-friends/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      // The book (public/book, written by scripts/build-gitbook.sh): a new build must show within minutes.
      { source: '/book/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400' }] },
    ];
  },
  // docs.clawbada.com serves the book — one self-contained page plus its PDF — straight from public/book.
  // Host-matched so the same deployment keeps serving the game on every other hostname.
  async rewrites() {
    const onDocsHost = [{ type: 'host' as const, value: DOCS_HOST }];
    return {
      beforeFiles: [
        { source: '/', has: onDocsHost, destination: '/book/index.html' },
        { source: '/index.html', has: onDocsHost, destination: '/book/index.html' },
        { source: '/pdf', has: onDocsHost, destination: '/book/Clawbada-Gitbook.pdf' },
        { source: '/Clawbada-Gitbook.pdf', has: onDocsHost, destination: '/book/Clawbada-Gitbook.pdf' },
      ],
    };
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Stub Node-only modules for client bundles
      config.resolve.fallback = {
        ...config.resolve.fallback,
        child_process: false,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
