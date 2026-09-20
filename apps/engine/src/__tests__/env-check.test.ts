import { describe, expect, test } from 'bun:test';
import { engineEnvProblems } from '../env-check';

const K = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

const testnet = {
  DATABASE_URL: 'postgres://x',
  OPERATOR_PRIVATE_KEY: K(1),
  BASE_SEPOLIA_RPC_URL: 'http://127.0.0.1:8545',
};

const mainnet = {
  CHAIN_ENV: 'mainnet',
  DATABASE_URL: 'postgres://x',
  BASE_RPC_URL: 'https://base',
  OPERATOR_PRIVATE_KEY: K(1),
  MATCHMAKER_PRIVATE_KEY: K(2),
  RESOLVER_PRIVATE_KEY: K(3),
  BOOST_ADMIN_PRIVATE_KEY: K(4),
};

describe('engineEnvProblems', () => {
  test('a single-key testnet is a valid configuration', () => {
    expect(engineEnvProblems(testnet)).toEqual([]);
    // the .env.example placeholders count as unset, and unset is fine off mainnet
    expect(engineEnvProblems({ ...testnet, MATCHMAKER_PRIVATE_KEY: '0x', RESOLVER_PRIVATE_KEY: '' })).toEqual([]);
  });

  test('the basics are still required', () => {
    expect(engineEnvProblems({ ...testnet, OPERATOR_PRIVATE_KEY: '0x' })).toEqual(['OPERATOR_PRIVATE_KEY is not set']);
    expect(engineEnvProblems({ ...testnet, DATABASE_URL: undefined })).toEqual(['DATABASE_URL is not set']);
  });

  test('D-26: a fully separated mainnet configuration starts', () => {
    expect(engineEnvProblems(mainnet)).toEqual([]);
  });

  test('D-26: mainnet refuses to start without a key per hot role', () => {
    for (const name of ['MATCHMAKER_PRIVATE_KEY', 'RESOLVER_PRIVATE_KEY', 'BOOST_ADMIN_PRIVATE_KEY']) {
      expect(engineEnvProblems({ ...mainnet, [name]: undefined })).toEqual([`${name} is not set`]);
      expect(engineEnvProblems({ ...mainnet, [name]: '0x' })).toEqual([`${name} is not set`]);
    }
  });

  test('D-26: mainnet refuses one key under two names', () => {
    expect(engineEnvProblems({ ...mainnet, BOOST_ADMIN_PRIVATE_KEY: K(3) })).toEqual([
      'RESOLVER_PRIVATE_KEY and BOOST_ADMIN_PRIVATE_KEY are the same key: on mainnet every hot role needs its own',
    ]);
    expect(engineEnvProblems({ ...mainnet, MATCHMAKER_PRIVATE_KEY: K(1).toUpperCase().replace('0X', '0x') })).toEqual([
      'OPERATOR_PRIVATE_KEY and MATCHMAKER_PRIVATE_KEY are the same key: on mainnet every hot role needs its own',
    ]);
  });
});
