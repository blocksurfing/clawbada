import { describe, test, expect } from 'bun:test';
import { teamCommitHash } from '../commit';

const ARENA = '0x00000000000000000000000000000000000000b2' as const;
const PLAYER = '0x00000000000000000000000000000000000000a1' as const;
const SALT = `0x${'00'.repeat(28)}deadbeef` as `0x${string}`;

describe('teamCommitHash — Solidity parity', () => {
  // Reference value pinned on both sides (test/BattleArena.t.sol `test_teamCommitHash_knownAnswer`):
  //   keccak256(abi.encodePacked(uint256 chainid, address arena, uint256 battleId, address player,
  //                              uint256 teamId, bytes32 salt))
  // for chainid=84532, arena=0x..B2, battleId=42, player=0x..A1, teamId=7, salt=0xDEADBEEF.
  // If this drifts, the client commit and the on-chain revealTeams verification disagree and no
  // battle can be revealed — so this KAT is a hard parity lock.
  test('matches the on-chain commit hash for a known vector', () => {
    expect(teamCommitHash(84532n, ARENA, 42n, PLAYER, 7n, SALT))
      .toBe('0x3acb94957257bbe0e24d8836673a2f023aa9b77dfe622e81b04409dcea38339f');
  });

  test('accepts the chain id as a number too', () => {
    expect(teamCommitHash(84532, ARENA, 42n, PLAYER, 7n, SALT)).toBe(teamCommitHash(84532n, ARENA, 42n, PLAYER, 7n, SALT));
  });

  test('HARDEN-1: is bound to the chain id (the same commit on Base mainnet differs)', () => {
    expect(teamCommitHash(8453n, ARENA, 42n, PLAYER, 7n, SALT))
      .toBe('0x249140c0474ffdae8c71a84523fe8743f823bac1c0dad443436d97f8f1e187a2');
  });

  test('HARDEN-1: is bound to the arena address (a redeploy differs)', () => {
    expect(teamCommitHash(84532n, '0x00000000000000000000000000000000000000b3', 42n, PLAYER, 7n, SALT))
      .toBe('0xb973f846f785184c485128249391def2fab181e835d3667d52cf7e165a3c0cba');
  });

  test('is sensitive to the player address (the bug the shared helper fixes)', () => {
    const a = teamCommitHash(84532n, ARENA, 42n, PLAYER, 7n, SALT);
    const b = teamCommitHash(84532n, ARENA, 42n, '0x00000000000000000000000000000000000000a2', 7n, SALT);
    expect(a).not.toBe(b);
  });
});
