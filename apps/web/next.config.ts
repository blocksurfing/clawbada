import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@clawbada/game-logic', '@clawbada/chain'],
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
