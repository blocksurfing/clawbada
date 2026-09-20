/**
 * Startup environment validation for the engine — a pure function so it can be tested.
 *
 * Audit 2026-09 D-26: on mainnet every hot role signs with its OWN key. The role policy
 * (docs/runbooks/admin-roles.md) sizes each key's blast radius independently — a stolen
 * resolver key can propose battle results, a stolen boost key can post mining boosts —
 * and one shared key collapses that into a single compromise that can do both for the
 * same colluding teams. The deploy scripts refuse to grant two hot roles to one address
 * on mainnet; the engine refuses to start configured as if they had.
 */

const ROLE_KEYS = ['MATCHMAKER_PRIVATE_KEY', 'RESOLVER_PRIVATE_KEY', 'BOOST_ADMIN_PRIVATE_KEY'] as const;

type Env = Record<string, string | undefined>;

/** Empty and the `.env.example` placeholder `0x` both mean "unset". */
function present(value: string | undefined): string | undefined {
  const v = value?.trim();
  return !v || v === '0x' ? undefined : v;
}

/** Every problem that must stop the engine from starting. Empty means good to go. */
export function engineEnvProblems(env: Env): string[] {
  const problems: string[] = [];
  const isMainnet = env.CHAIN_ENV === 'mainnet';

  const required = ['DATABASE_URL', 'OPERATOR_PRIVATE_KEY', isMainnet ? 'BASE_RPC_URL' : 'BASE_SEPOLIA_RPC_URL'];
  if (isMainnet) required.push(...ROLE_KEYS);
  for (const name of required) {
    if (!present(env[name])) problems.push(`${name} is not set`);
  }

  if (isMainnet) {
    // Same key under two names is the shared-key configuration with extra steps.
    const names = ['OPERATOR_PRIVATE_KEY', ...ROLE_KEYS];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = present(env[names[i]!]);
        const b = present(env[names[j]!]);
        if (a && b && a.toLowerCase() === b.toLowerCase()) {
          problems.push(`${names[i]} and ${names[j]} are the same key: on mainnet every hot role needs its own`);
        }
      }
    }
  }

  return problems;
}
