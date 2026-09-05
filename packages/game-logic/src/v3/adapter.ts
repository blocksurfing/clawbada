/**
 * Chain → battle adapters. The engine reads lobsters from LobsterNFT (token id,
 * packed DNA, evolution tier) and needs the sim's LobsterInput plus the Unity
 * client's per-part class ids for DNA-driven visuals.
 */
import { calculatePurity, decodeDNA } from '../dna';
import { EvolutionTier, LegendStatus } from '../types';
import type { LobsterInput } from './state';

export interface ChainLobsterLike {
  tokenId: bigint | string | number;
  dna: bigint;
  evolutionTier: EvolutionTier | number;
  /** Optional: trusted on-chain purity; recomputed from DNA when omitted. */
  purity?: number;
}

export function lobsterInputFromChain(l: ChainLobsterLike): LobsterInput {
  const d = decodeDNA(l.dna);
  return {
    id: l.tokenId.toString(),
    class: d.class,
    tier: Number(l.evolutionTier) as EvolutionTier,
    purity: l.purity ?? calculatePurity(l.dna),
    legend: d.legend === LegendStatus.Legend,
  };
}

/** Dominant-gene class affinity per body part, DNA slot order [Carapace, Claws, Tail, Antennae, Eyes, Legs]. */
export function partClassIds(dna: bigint): number[] {
  return decodeDNA(dna).bodyParts.map(p => p.dominant.classAffinity);
}
