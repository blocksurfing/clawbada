import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@clawbada/game-logic', '@clawbada/chain'],
  // Unity WebGL build (gitignored; built locally via BuildScript.BuildWebGL). Brotli
  // artifacts need the encoding + type headers; decompression fallback covers hosts that strip them.
  async headers() {
    return [
      { source: '/unity-build/Build/:file*.br', headers: [{ key: 'Content-Encoding', value: 'br' }] },
      { source: '/unity-build/Build/:file*.wasm.br', headers: [{ key: 'Content-Type', value: 'application/wasm' }] },
      { source: '/unity-build/Build/:file*.js.br', headers: [{ key: 'Content-Type', value: 'application/javascript' }] },
      { source: '/unity-build/Build/:file*.data.br', headers: [{ key: 'Content-Type', value: 'application/octet-stream' }] },
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
