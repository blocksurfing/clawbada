import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@clawbada/game-logic', '@clawbada/chain'],
};

export default nextConfig;
