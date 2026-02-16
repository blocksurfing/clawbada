type Address = `0x${string}`;

function envAddr(key: string): Address {
  return (process.env[key] ?? '0x') as Address;
}

export const addresses = {
  clawToken: envAddr('CLAW_TOKEN_ADDRESS'),
  lobsterNFT: envAddr('LOBSTER_NFT_ADDRESS'),
  teamManager: envAddr('TEAM_MANAGER_ADDRESS'),
  breedingLab: envAddr('BREEDING_LAB_ADDRESS'),
  miningPool: envAddr('MINING_POOL_ADDRESS'),
  marketplace: envAddr('MARKETPLACE_ADDRESS'),
  treasury: envAddr('TREASURY_ADDRESS'),
  faucet: envAddr('FAUCET_ADDRESS'),
  battleArena: envAddr('BATTLE_ARENA_ADDRESS'),
  battleResolver: envAddr('BATTLE_RESOLVER_ADDRESS'),
  battleVRF: envAddr('BATTLE_VRF_ADDRESS'),
  evolutionLab: envAddr('EVOLUTION_LAB_ADDRESS'),
  repairShop: envAddr('REPAIR_SHOP_ADDRESS'),
} as const;
