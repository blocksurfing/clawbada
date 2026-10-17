import type { NextConfig } from 'next';

/** The book's hostname: the sidebar's Docs link, and the Vercel domain on this project. */
const DOCS_HOST = 'docs.clawbada.com';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@clawbada/game-logic', '@clawbada/chain'],
  // Unity WebGL build (gitignored; built locally via BuildScript.BuildWebGL). The build uses
  // Brotli WITH Unity's decompression fallback, so the compressed artifacts are `*.unityweb`
  // and the loader inflates them itself — no Content-Encoding/Content-Type headers required.
  async headers() {
    return [
      { source: '/unity-build/Build/:file*.unityweb', headers: [{ key: 'Content-Type', value: 'application/octet-stream' }] },
      // Arena music is content-hashed by scripts/build-music.ts (BGM_Arena_<Tier>.<sha8>.m4a), so it can be
      // cached for a year and still invalidate the moment a track changes — independent of Unity rebuilds.
      { source: '/audio/music/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
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
