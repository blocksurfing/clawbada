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
 *  role and the contract reverts (AccessControl). Off mainnet it falls
 *  back to OPERATOR_PRIVATE_KEY when MATCHMAKER_PRIVATE_KEY is unset so
 *  testnet/dev environments where the deployer holds both roles still
 *  work; on mainnet there is no fallback (see roleKey). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMatchmakerClient(testnet = false): any {
  return walletFromKey(roleKey('MATCHMAKER_PRIVATE_KEY', testnet), testnet);
}

/** Codex cross-cutting HIGH-1: separate signer for `settle` and
 *  `settle` calls (RESOLVER_ROLE). Same fallback semantics as
 *  getMatchmakerClient. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getResolverClient(testnet = false): any {
  return walletFromKey(roleKey('RESOLVER_PRIVATE_KEY', testnet), testnet);
}

/** Signer for the weekly battle-rank boost table (`MiningPool.setTeamBoosts` /
 *  `activateBoostEpoch`, BOOST_ADMIN_ROLE), used by the engine's operator
 *  worker. Same fallback semantics as getMatchmakerClient: BOOST_ADMIN_PRIVATE_KEY,
 *  else (off mainnet only) OPERATOR_PRIVATE_KEY so a single-key testnet keeps
 *  working. `.env.example` ships the placeholder `0x`, which is treated as unset
 *  rather than handed to viem. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBoostAdminClient(testnet = false): any {
  return walletFromKey(roleKey('BOOST_ADMIN_PRIVATE_KEY', testnet), testnet);
}

/**
 * The private key for one hot role.
 *
 * Off mainnet an unset role key falls back to OPERATOR_PRIVATE_KEY, so a single-key
 * testnet or local chain keeps working.
 *
 * On mainnet (`testnet === false`) there is NO fallback (audit 2026-09 D-26). The role
 * policy sizes each hot key's blast radius on its own: a stolen resolver key can propose
 * battle results, a stolen boost key can post mining boosts. One shared key collapses
 * that — a single compromise could settle self-play battles AND boost the same teams'
 * mining, with no second service to notice. The deploy scripts already refuse to grant
 * two hot roles to one address on mainnet; this makes the server refuse to run as if
 * they had, rather than sign with a key that holds the wrong role and fail on-chain.
 */
export function roleKey(
  name: 'MATCHMAKER_PRIVATE_KEY' | 'RESOLVER_PRIVATE_KEY' | 'BOOST_ADMIN_PRIVATE_KEY',
  testnet: boolean,
): string {
  const own = presentKey(process.env[name]);
  if (own) return own;
  if (!testnet) {
    throw new Error(
      `${name} not set. On mainnet every hot role needs its own key: ` +
        'the OPERATOR_PRIVATE_KEY fallback is for testnet and local chains only.',
    );
  }
  const shared = presentKey(process.env.OPERATOR_PRIVATE_KEY);
  if (!shared) throw new Error(`${name} (or OPERATOR_PRIVATE_KEY fallback) not set`);
  return shared;
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
