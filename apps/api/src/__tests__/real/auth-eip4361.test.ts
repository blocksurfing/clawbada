/**
 * Audit C-01, with REAL keys and the REAL @clawbada/chain (this folder runs in its own process,
 * because the unit tests replace that package with a stub whose verifyMessage always says yes).
 *
 * The old login message was the bare text `Clawbada Auth: <unix time>`. Any site, or a testnet
 * deployment of Clawbada itself, could ask a player to sign that identical string and the mainnet
 * API would accept it. These tests sign real messages and check what the API will and will not take.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { privateKeyToAccount, buildAuthMessage, newAuthNonce, AUTH_TTL_SEC } from '@clawbada/chain';
import { verifyWalletSignature, allowedAuthDomains, authChainId } from '../../middleware/auth';

const player = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const now = () => Math.floor(Date.now() / 1000);

async function sign(over: Partial<{ domain: string; chainId: number; nonce: string; issuedAt: number }> = {}) {
  const p = { domain: 'clawbada-web.vercel.app', chainId: 84532, nonce: newAuthNonce(), issuedAt: now(), ...over };
  const signature = await player.signMessage({ message: buildAuthMessage({ ...p, address: player.address }) });
  return { ...p, signature };
}
const verify = (s: Awaited<ReturnType<typeof sign>>, over: Partial<{ domain: string | null; nonce: string }> = {}) =>
  verifyWalletSignature({ address: player.address, signature: s.signature, timestamp: s.issuedAt, nonce: over.nonce ?? s.nonce, domain: over.domain === undefined ? s.domain : over.domain });

const saved = { ...process.env };
beforeEach(() => { delete process.env.AUTH_DOMAINS; delete process.env.AUTH_ALLOW_LEGACY; delete process.env.CHAIN_ENV; process.env.NODE_ENV = 'test'; });
afterEach(() => { process.env = { ...saved }; });

describe('EIP-4361 login (C-01)', () => {
  test('a message signed for an allowed domain and this chain verifies', async () => {
    const v = await verify(await sign());
    expect(v.checksumAddress).toBe(player.address);
    expect(v.expiresAt).toBeGreaterThan(now());
  });

  test('a caller that sends no domain is checked against the default one (agents have no page origin)', async () => {
    const s = await sign({ domain: allowedAuthDomains()[0] });
    expect((await verify(s, { domain: null })).checksumAddress).toBe(player.address);
  });

  test('PHISHING: a signature the player made for another site is useless here', async () => {
    const phished = await sign({ domain: 'clawbada-web.evil.example' });
    // Presented honestly: the domain is not on the allow-list.
    await expect(verify(phished)).rejects.toThrow(/not allowed to sign in/);
    // Presented dishonestly as the real site: the API rebuilds the message with the REAL domain,
    // which is not what the player signed.
    await expect(verify(phished, { domain: 'clawbada-web.vercel.app' })).rejects.toThrow(/Invalid signature|Signature verification failed/);
  });

  test('WRONG CHAIN: a signature made on the testnet deployment does not log in to mainnet', async () => {
    const testnetSig = await sign({ chainId: 84532 });
    process.env.CHAIN_ENV = 'mainnet';
    expect(authChainId()).toBe(8453);
    await expect(verify(testnetSig)).rejects.toThrow(/Invalid signature|Signature verification failed/);
  });

  test('the nonce and the timestamp are part of what was signed', async () => {
    const s = await sign();
    await expect(verify(s, { nonce: newAuthNonce() })).rejects.toThrow();
    await expect(verifyWalletSignature({ address: player.address, signature: s.signature, timestamp: s.issuedAt + 1, nonce: s.nonce, domain: s.domain })).rejects.toThrow();
  });

  test('it still expires: five minutes after it was issued', async () => {
    await expect(verify(await sign({ issuedAt: now() - AUTH_TTL_SEC - 5 }))).rejects.toThrow(/expired/i);
  });

  test('the old bare-string message is refused, and only the rollout switch brings it back', async () => {
    const ts = now();
    const legacySig = await player.signMessage({ message: `Clawbada Auth: ${ts}` });
    const legacy = { address: player.address, signature: legacySig, timestamp: ts };
    await expect(verifyWalletSignature(legacy)).rejects.toThrow(/EIP-4361/);
    process.env.AUTH_ALLOW_LEGACY = '1';
    expect((await verifyWalletSignature(legacy)).checksumAddress).toBe(player.address);
  });

  test('production allows only configured sites: no localhost by default, AUTH_DOMAINS overrides', () => {
    expect(allowedAuthDomains({ NODE_ENV: 'production' })).toEqual(['clawbada-web.vercel.app']);
    expect(allowedAuthDomains({ NODE_ENV: 'development' })).toContain('localhost:3000');
    expect(allowedAuthDomains({ NODE_ENV: 'production', AUTH_DOMAINS: 'play.clawbada.com, clawbada-web.vercel.app' })).toEqual(['play.clawbada.com', 'clawbada-web.vercel.app']);
  });
});
