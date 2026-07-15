import { keccak256, encodePacked } from 'viem';

/**
 * Canonical team commit-reveal hash — the SINGLE source of truth shared by the web client
 * (commit), the API (server-side reveal verification), and any tooling.
 *
 * Must byte-for-byte match `BattleArena.sol`:
 *   keccak256(abi.encodePacked(battleId, player, teamId, salt))
 *
 * NOTE: the player address is part of the preimage. An earlier inline web implementation
 * omitted it, so no reveal could ever have validated on-chain (F5-01 integration fix).
 * Keeping this in one place prevents that drift from recurring.
 */
export function teamCommitHash(
  battleId: bigint,
  player: `0x${string}`,
  teamId: bigint,
  salt: `0x${string}`,
): `0x${string}` {
  return keccak256(
    encodePacked(['uint256', 'address', 'uint256', 'bytes32'], [battleId, player, teamId, salt]),
  );
}
