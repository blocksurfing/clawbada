type Address = `0x${string}`;

function envAddr(key: string): Address {
  const value = process.env[key];
  if (!value || value === '0x') {
    throw new Error(
      `Missing contract address: ${key} is not set.\n` +
        `Run "bun run sync-deploy <network>" after deployment, or set ${key} in .env manually.`,
    );
  }
  return value as Address;
}

/** Lazy-loaded addresses — only throws when first accessed, not at import time. */
function lazyAddresses() {
  const cache: Partial<Record<string, Address>> = {};

  return new Proxy({} as Record<string, Address>, {
    get(_target, prop: string) {
      if (cache[prop] !== undefined) return cache[prop];

      const envMap: Record<string, string> = {
        clawToken: 'CLAW_TOKEN_ADDRESS',
        lobsterNFT: 'LOBSTER_NFT_ADDRESS',
        teamManager: 'TEAM_MANAGER_ADDRESS',
        breedingLab: 'BREEDING_LAB_ADDRESS',
        miningPool: 'MINING_POOL_ADDRESS',
        marketplace: 'MARKETPLACE_ADDRESS',
        treasury: 'TREASURY_ADDRESS',
        faucet: 'FAUCET_ADDRESS',
        battleArena: 'BATTLE_ARENA_ADDRESS',
        battleVRF: 'BATTLE_VRF_ADDRESS',
        evolutionLab: 'EVOLUTION_LAB_ADDRESS',
        repairShop: 'REPAIR_SHOP_ADDRESS',
      };

      const envKey = envMap[prop];
      if (!envKey) return undefined;

      const addr = envAddr(envKey);
      cache[prop] = addr;
      return addr;
    },
  });
}

export const addresses = lazyAddresses() as {
  readonly clawToken: Address;
  readonly lobsterNFT: Address;
  readonly teamManager: Address;
  readonly breedingLab: Address;
  readonly miningPool: Address;
  readonly marketplace: Address;
  readonly treasury: Address;
  readonly faucet: Address;
  readonly battleArena: Address;
  readonly battleVRF: Address;
  readonly evolutionLab: Address;
  readonly repairShop: Address;
};
