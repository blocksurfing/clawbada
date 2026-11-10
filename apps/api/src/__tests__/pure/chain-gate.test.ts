import { describe, test, expect } from 'bun:test';
import { chainRoutesOpen, CHAIN_ONLY_PATHS } from '../../lib/chain-gate';

describe('chainRoutesOpen', () => {
  test('closed until the contracts are configured', () => {
    expect(chainRoutesOpen({})).toBe(false);
    expect(chainRoutesOpen({ LOBSTER_NFT_ADDRESS: '' })).toBe(false);
    expect(chainRoutesOpen({ LOBSTER_NFT_ADDRESS: '0x' })).toBe(false);
    expect(chainRoutesOpen({ LOBSTER_NFT_ADDRESS: '0x1111111111111111111111111111111111111111' })).toBe(true);
  });

  test('CHAIN_ROUTES forces it either way', () => {
    expect(chainRoutesOpen({ CHAIN_ROUTES: 'on' })).toBe(true);
    expect(chainRoutesOpen({ CHAIN_ROUTES: 'off', LOBSTER_NFT_ADDRESS: '0x1111111111111111111111111111111111111111' })).toBe(false);
    expect(chainRoutesOpen({ CHAIN_ROUTES: 'maybe' })).toBe(false);   // anything else: decided by the address
  });

  test('the Dojo is not behind the gate: no combat, friend, auth or render path', () => {
    for (const p of CHAIN_ONLY_PATHS) expect(p).not.toMatch(/combat|friend|auth|render|agent|leaderboard|activity/);
  });
});
