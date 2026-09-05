import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@clawbada/game-logic', '@clawbada/chain'],
  // Unity WebGL build (gitignored; built locally via BuildScript.BuildWebGL). The build uses
  // Brotli WITH Unity's decompression fallback, so the compressed artifacts are `*.unityweb`
  // and the loader inflates them itself — no Content-Encoding/Content-Type headers required.
  async headers() {
    return [
      { source: '/unity-build/Build/:file*.unityweb', headers: [{ key: 'Content-Type', value: 'application/octet-stream' }] },
    ];
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
