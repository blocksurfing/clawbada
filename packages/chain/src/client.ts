import { createPublicClient, createWalletClient, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPublicClient(testnet = false): any {
  const chain = testnet ? baseSepolia : base;
  const rpcUrl = testnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_RPC_URL;

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

export function getWalletClient(testnet = false) {
  const chain = testnet ? baseSepolia : base;
  const rpcUrl = testnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_RPC_URL;

  return createWalletClient({
    chain,
    transport: http(rpcUrl),
  });
}

/**
 * Returns a wallet client configured with the server operator key.
 * Used for privileged on-chain actions: createBattle, settle, submitVRF.
 * Requires OPERATOR_PRIVATE_KEY env var.
 *
 * Codex cross-cutting HIGH-1: kept for backwards-compat (e.g., season
 * monitor, drand beacon submitter). The battle hot path uses the
 * role-specific helpers below.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOperatorClient(testnet = false): any {
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (!key) throw new Error('OPERATOR_PRIVATE_KEY not set');
  return walletFromKey(key, testnet);
}

/** Codex cross-cutting HIGH-1: separate signer for `createBattle` calls.
 *  Mainnet `Configure.s.sol` grants `MATCHMAKER_ROLE` to a distinct
 *  `MATCHMAKER_ADDRESS` (DeployHelpers.s.sol requires it != RESOLVER).
 *  Without a dedicated key the engine handler would sign with the wrong
 *  role and the contract reverts (AccessControl). Falls back to
 *  OPERATOR_PRIVATE_KEY when MATCHMAKER_PRIVATE_KEY is unset so testnet/
 *  dev environments where the deployer holds both roles still work. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMatchmakerClient(testnet = false): any {
  const key = process.env.MATCHMAKER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY;
  if (!key) throw new Error('MATCHMAKER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY fallback) not set');
  return walletFromKey(key, testnet);
}

/** Codex cross-cutting HIGH-1: separate signer for `settle` and
 *  `settle` calls (RESOLVER_ROLE). Same fallback semantics as
 *  getMatchmakerClient. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getResolverClient(testnet = false): any {
  const key = process.env.RESOLVER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY;
  if (!key) throw new Error('RESOLVER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY fallback) not set');
  return walletFromKey(key, testnet);
}

/** Signer for the weekly battle-rank boost table (`MiningPool.setTeamBoosts` /
 *  `activateBoostEpoch`, BOOST_ADMIN_ROLE), used by the engine's operator
 *  worker. Same fallback semantics as getMatchmakerClient: BOOST_ADMIN_PRIVATE_KEY,
 *  else OPERATOR_PRIVATE_KEY so a single-key testnet keeps working. `.env.example`
 *  ships the placeholder `0x`, which is treated as unset rather than handed to
 *  viem. Give the role its own key in prod: the outbox serialises engine-side
 *  writes, but a shared key still shares a nonce with the other roles. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBoostAdminClient(testnet = false): any {
  const key = presentKey(process.env.BOOST_ADMIN_PRIVATE_KEY) ?? presentKey(process.env.OPERATOR_PRIVATE_KEY);
  if (!key) throw new Error('BOOST_ADMIN_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY fallback) not set');
  return walletFromKey(key, testnet);
}

/** Treat empty and the `.env.example` placeholder `0x` as unset. */
function presentKey(value: string | undefined): string | undefined {
  if (!value || value.trim() === '' || value.trim() === '0x') return undefined;
  return value;
}

function walletFromKey(key: string, testnet: boolean) {
  const account = privateKeyToAccount(key as `0x${string}`);
  const chain = testnet ? baseSepolia : base;
  const rpcUrl = testnet ? process.env.BASE_SEPOLIA_RPC_URL : process.env.BASE_RPC_URL;
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}
