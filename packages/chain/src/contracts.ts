import { getContract, type PublicClient } from 'viem';
import { addresses } from './addresses';
import {
  ClawTokenAbi,
  LobsterNFTAbi,
  TeamManagerAbi,
  BreedingLabAbi,
  MiningPoolAbi,
  MarketplaceAbi,
  TreasuryAbi,
  FaucetAbi,
  BattleArenaAbi,
  BattleVRFAbi,
  EvolutionLabAbi,
  RepairShopAbi,
} from './abis';

export function getClawToken(client: PublicClient) {
  return getContract({ address: addresses.clawToken, abi: ClawTokenAbi, client });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getLobsterNFT(client: PublicClient): any {
  return getContract({ address: addresses.lobsterNFT, abi: LobsterNFTAbi, client });
}

export function getTeamManager(client: PublicClient) {
  return getContract({ address: addresses.teamManager, abi: TeamManagerAbi, client });
}

export function getBreedingLab(client: PublicClient) {
  return getContract({ address: addresses.breedingLab, abi: BreedingLabAbi, client });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMiningPool(client: PublicClient): any {
  return getContract({ address: addresses.miningPool, abi: MiningPoolAbi, client });
}

export function getMarketplace(client: PublicClient) {
  return getContract({ address: addresses.marketplace, abi: MarketplaceAbi, client });
}

export function getTreasury(client: PublicClient) {
  return getContract({ address: addresses.treasury, abi: TreasuryAbi, client });
}

export function getFaucet(client: PublicClient) {
  return getContract({ address: addresses.faucet, abi: FaucetAbi, client });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBattleArena(client: PublicClient): any {
  return getContract({ address: addresses.battleArena, abi: BattleArenaAbi, client });
}

export function getBattleVRF(client: PublicClient) {
  return getContract({ address: addresses.battleVRF, abi: BattleVRFAbi, client });
}

export function getEvolutionLab(client: PublicClient) {
  return getContract({ address: addresses.evolutionLab, abi: EvolutionLabAbi, client });
}

export function getRepairShop(client: PublicClient) {
  return getContract({ address: addresses.repairShop, abi: RepairShopAbi, client });
}
