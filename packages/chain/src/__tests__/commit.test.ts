import { describe, test, expect } from 'bun:test';
import { teamCommitHash } from '../commit';

describe('teamCommitHash — Solidity parity', () => {
  // Reference value computed from BattleArena's encoding in Foundry:
  //   keccak256(abi.encodePacked(uint256 battleId, address player, uint256 teamId, bytes32 salt))
  // for battleId=42, player=0x..A1, teamId=7, salt=0xDEADBEEF.
  // If this drifts, the web commit and the on-chain revealTeams verification disagree and no
  // battle can be revealed — so this KAT is a hard parity lock.
  test('matches the on-chain commit hash for a known vector', () => {
    const h = teamCommitHash(
      42n,
      '0x00000000000000000000000000000000000000A1',
      7n,
      `0x${'00'.repeat(28)}deadbeef` as `0x${string}`,
    );
    expect(h).toBe('0x36ec17b7d454cca7411f58b0094f93f571e339b4aa430ce6418aa23b491d8ba1');
  });

  test('is sensitive to the player address (the bug the shared helper fixes)', () => {
    const salt = `0x${'00'.repeat(28)}deadbeef` as `0x${string}`;
    const a = teamCommitHash(42n, '0x00000000000000000000000000000000000000A1', 7n, salt);
    const b = teamCommitHash(42n, '0x00000000000000000000000000000000000000A2', 7n, salt);
    expect(a).not.toBe(b);
  });
});
