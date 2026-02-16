import { BREED_BASE_COST, BREED_MULTIPLIERS, GENERATION_COST_MULT, MULT_DENOM } from './constants';

/**
 * Calculate breeding cost for a single parent.
 *
 * per_parent_cost = 500 × breed_multiplier × 1.5^parent_generation
 *
 * @param breedIndex 0-based index of this parent's next breed (0 = 1st breed)
 * @param generation Parent's generation (0 for faucet/original)
 * @returns Cost in $CLAW (bigint)
 */
export function breedCostPerParent(breedIndex: number, generation: number): bigint {
  if (breedIndex < 0 || breedIndex >= BREED_MULTIPLIERS.length) {
    throw new Error(`Invalid breed index: ${breedIndex}. Must be 0-4.`);
  }

  const multiplier = BREED_MULTIPLIERS[breedIndex];

  // 1.5^generation using fixed-point: (1500/1000)^gen
  let genMult = MULT_DENOM;
  for (let i = 0; i < generation; i++) {
    genMult = (genMult * GENERATION_COST_MULT) / MULT_DENOM;
  }

  return (BREED_BASE_COST * multiplier * genMult) / (MULT_DENOM * MULT_DENOM);
}

/**
 * Calculate total breeding cost for both parents.
 *
 * @param parentABreedIndex Parent A's 0-based breed index
 * @param parentAGeneration Parent A's generation
 * @param parentBBreedIndex Parent B's 0-based breed index
 * @param parentBGeneration Parent B's generation
 * @returns Total cost in $CLAW (bigint)
 */
export function totalBreedCost(
  parentABreedIndex: number,
  parentAGeneration: number,
  parentBBreedIndex: number,
  parentBGeneration: number,
): bigint {
  return (
    breedCostPerParent(parentABreedIndex, parentAGeneration) +
    breedCostPerParent(parentBBreedIndex, parentBGeneration)
  );
}
