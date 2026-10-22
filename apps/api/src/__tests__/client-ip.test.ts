import { describe, expect, test } from 'bun:test';
import { pickForwardedFor } from '../lib/client-ip';

describe('pickForwardedFor (rightmost-of-N behind an appending edge)', () => {
  test('one trusted hop: the entry the edge appended, never what the client sent', () => {
    expect(pickForwardedFor('203.0.113.9', 1)).toBe('203.0.113.9');
    // A client that prepends its own entries cannot move the pick.
    expect(pickForwardedFor('1.1.1.1, 2.2.2.2, 203.0.113.9', 1)).toBe('203.0.113.9');
  });

  test('two trusted hops (external load balancer in front of Cloud Run): second from the right', () => {
    expect(pickForwardedFor('203.0.113.9, 34.0.0.1', 2)).toBe('203.0.113.9');
    expect(pickForwardedFor('9.9.9.9, 203.0.113.9, 34.0.0.1', 2)).toBe('203.0.113.9');
  });

  test('too few entries for the hop count, or no header, yields null (falls back to the peer address)', () => {
    expect(pickForwardedFor('203.0.113.9', 2)).toBeNull();
    expect(pickForwardedFor('', 1)).toBeNull();
    expect(pickForwardedFor(null, 1)).toBeNull();
    expect(pickForwardedFor(' , ', 1)).toBeNull();
  });
});
