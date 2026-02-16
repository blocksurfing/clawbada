import { getContract, type GetContractReturnType, type PublicClient } from 'viem';
import { addresses } from './addresses';

// TODO: Import real ABIs after running extract-abis
// import { ClawTokenAbi, LobsterNFTAbi, ... } from './abis';

/**
 * Contract factory stubs. After ABIs are extracted, each function
 * will return a fully typed viem contract instance.
 *
 * Example (after ABIs):
 *   export function getClawToken(client: PublicClient) {
 *     return getContract({ address: addresses.clawToken, abi: ClawTokenAbi, client });
 *   }
 */

export function getClawToken(client: PublicClient) {
  return getContract({ address: addresses.clawToken, abi: [] as const, client });
}

export function getLobsterNFT(client: PublicClient) {
  return getContract({ address: addresses.lobsterNFT, abi: [] as const, client });
}

export function getTeamManager(client: PublicClient) {
  return getContract({ address: addresses.teamManager, abi: [] as const, client });
}

export function getBreedingLab(client: PublicClient) {
  return getContract({ address: addresses.breedingLab, abi: [] as const, client });
}

export function getMiningPool(client: PublicClient) {
  return getContract({ address: addresses.miningPool, abi: [] as const, client });
}

export function getMarketplace(client: PublicClient) {
  return getContract({ address: addresses.marketplace, abi: [] as const, client });
}

export function getTreasury(client: PublicClient) {
  return getContract({ address: addresses.treasury, abi: [] as const, client });
}

export function getFaucet(client: PublicClient) {
  return getContract({ address: addresses.faucet, abi: [] as const, client });
}

export function getBattleArena(client: PublicClient) {
  return getContract({ address: addresses.battleArena, abi: [] as const, client });
}

export function getBattleVRF(client: PublicClient) {
  return getContract({ address: addresses.battleVRF, abi: [] as const, client });
}

export function getEvolutionLab(client: PublicClient) {
  return getContract({ address: addresses.evolutionLab, abi: [] as const, client });
}

export function getRepairShop(client: PublicClient) {
  return getContract({ address: addresses.repairShop, abi: [] as const, client });
}
