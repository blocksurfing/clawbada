import { keccak256, encodePacked } from 'viem';

/**
 * Canonical team commit-reveal hash — the SINGLE source of truth shared by the web client
 * (commit), the API (server-side reveal verification), the engine's reveal watcher and any
 * tooling (the e2e agent kit).
 *
 * Must byte-for-byte match `BattleArena.teamCommitHash`:
 *   keccak256(abi.encodePacked(block.chainid, address(arena), battleId, player, teamId, salt))
 *
 * HARDEN-1 (2026-10-06): the chain id and the arena address are part of the preimage, so a
 * commit built for one deployment (a testnet, a fork, a redeploy) can never open on another.
 * `chainId` is the chain the arena is deployed on (84532 Base Sepolia / 8453 Base) and `arena`
 * its address — both come from `GET /api/auth/params` for a client that does not hold a
 * deployment file.
 *
 * NOTE: the player address is part of the preimage. An earlier inline web implementation
 * omitted it, so no reveal could ever have validated on-chain (F5-01 integration fix).
 * Keeping this in one place prevents that drift from recurring.
 */
export function teamCommitHash(
  chainId: bigint | number,
  arena: `0x${string}`,
  battleId: bigint,
  player: `0x${string}`,
  teamId: bigint,
  salt: `0x${string}`,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ['uint256', 'address', 'uint256', 'address', 'uint256', 'bytes32'],
      [BigInt(chainId), arena, battleId, player, teamId, salt],
    ),
  );
}
