import { describe, test, expect } from 'bun:test';
import { SocketBudget, socketLimitsFromEnv, DEFAULT_SOCKET_LIMITS } from '../../lib/socket-budget';

const player = (address: string, ip: string) => ({ address, ip });
const spectator = (ip: string) => ({ address: null, ip });

describe('SocketBudget', () => {
  test('one address holds at most perAddress sockets, whatever IPs they come from', () => {
    const b = new SocketBudget({ perAddress: 2, perIp: 10, total: 100 });
    expect(b.reserve(player('0xA', '1.1.1.1'))).toBeNull();
    expect(b.reserve(player('0xa', '2.2.2.2'))).toBeNull();          // same address, different case and IP
    expect(b.reserve(player('0xA', '3.3.3.3'))).toBe('address');
    expect(b.counts().total).toBe(2);                                // a refusal takes nothing
  });

  test('one IP holds at most perIp sockets, however many addresses it makes up', () => {
    const b = new SocketBudget({ perAddress: 8, perIp: 3, total: 100 });
    for (let i = 0; i < 3; i++) expect(b.reserve(player(`0x${i}`, '9.9.9.9'))).toBeNull();
    expect(b.reserve(player('0xfresh', '9.9.9.9'))).toBe('ip');
    expect(b.reserve(spectator('9.9.9.9'))).toBe('ip');              // spectators count against the IP too
    expect(b.reserve(player('0xfresh', '8.8.8.8'))).toBeNull();      // another IP is unaffected
  });

  test('sockets never take more than the total, and the refusal says so', () => {
    const b = new SocketBudget({ perAddress: 8, perIp: 16, total: 4 });
    for (let i = 0; i < 4; i++) expect(b.reserve(player(`0x${i}`, `10.0.0.${i}`))).toBeNull();
    expect(b.reserve(player('0xnew', '10.0.0.99'))).toBe('server');
  });

  test('a released slot can be taken again, and the maps do not keep empty entries', () => {
    const b = new SocketBudget({ perAddress: 1, perIp: 1, total: 1 });
    const who = player('0xA', '1.1.1.1');
    expect(b.reserve(who)).toBeNull();
    expect(b.reserve(who)).toBe('server');
    b.release(who);
    expect(b.counts()).toEqual({ total: 0, addresses: 0, ips: 0 });
    expect(b.reserve(who)).toBeNull();
  });

  test('an unresolved IP is not held to the per-IP cap, but still counts toward the total', () => {
    const b = new SocketBudget({ perAddress: 8, perIp: 1, total: 3 });
    for (let i = 0; i < 3; i++) expect(b.reserve(player(`0x${i}`, 'unknown'))).toBeNull();
    expect(b.reserve(player('0x9', 'unknown'))).toBe('server');
  });

  test('a spectator has no address to count', () => {
    const b = new SocketBudget({ perAddress: 1, perIp: 5, total: 10 });
    expect(b.reserve(spectator('1.1.1.1'))).toBeNull();
    expect(b.reserve(spectator('1.1.1.1'))).toBeNull();
    expect(b.counts()).toEqual({ total: 2, addresses: 0, ips: 1 });
    b.release(spectator('1.1.1.1'));
    b.release(spectator('1.1.1.1'));
    expect(b.counts()).toEqual({ total: 0, addresses: 0, ips: 0 });
  });

  test('limits come from the environment, falling back to the defaults on anything that is not a positive whole number', () => {
    expect(socketLimitsFromEnv({})).toEqual(DEFAULT_SOCKET_LIMITS);
    expect(DEFAULT_SOCKET_LIMITS).toEqual({ perAddress: 8, perIp: 16, total: 600 });
    expect(socketLimitsFromEnv({ WS_PER_IP_MAX_CONCURRENT: '4', WS_MAX_SOCKETS: '50' })).toEqual({ perAddress: 8, perIp: 4, total: 50 });
    expect(socketLimitsFromEnv({ WS_PER_IP_MAX_CONCURRENT: '0', WS_MAX_SOCKETS: 'lots' })).toEqual(DEFAULT_SOCKET_LIMITS);
  });
});
