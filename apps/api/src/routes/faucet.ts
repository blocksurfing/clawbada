import { Hono } from 'hono';
import { FaucetAbi, addresses } from '@clawbada/chain';
import { walletAuth } from '../middleware/auth';
import { catchErrors, ApiError } from '../lib/errors';
import { readFaucetStatus, serializeBigInts } from '../lib/chain';
import { buildCalldata, singleStep } from '../lib/calldata';

export const faucetRoutes = new Hono();

// GET /api/faucet/status/:address — check eligibility and claim status
faucetRoutes.get(
  '/status/:address',
  catchErrors(async (c) => {
    const { address } = c.req.param();
    const status = await readFaucetStatus(address);

    return c.json(serializeBigInts({
      address,
      ...status,
      canClaimLobsters: status.isOpen && status.isEligible && !status.hasClaimedLobsters,
      canClaimClaw: status.isOpen && status.isEligible && status.hasClaimedLobsters && !status.hasClaimedClaw,
    }));
  }),
);

// POST /api/faucet/claim-lobsters — claim 5 soulbound lobsters
faucetRoutes.post(
  '/claim-lobsters',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const status = await readFaucetStatus(address);

    if (!status.isOpen) {
      throw new ApiError('INVALID_INPUT', 'Faucet is closed');
    }
    if (!status.isEligible) {
      throw new ApiError('INVALID_INPUT', 'Wallet not eligible (requires ≥0.001 ETH, ≥7 days old, ≥3 txs)');
    }
    if (status.hasClaimedLobsters) {
      throw new ApiError('INVALID_INPUT', 'Lobsters already claimed');
    }

    const calldata = buildCalldata(
      addresses.faucet,
      FaucetAbi as any,
      'claimLobsters',
    );

    return c.json(singleStep('Claim 5 soulbound lobsters from faucet', calldata));
  }),
);

// POST /api/faucet/claim-claw — claim 7,000 $CLAW drip
faucetRoutes.post(
  '/claim-claw',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const status = await readFaucetStatus(address);

    if (!status.isOpen) {
      throw new ApiError('INVALID_INPUT', 'Faucet is closed');
    }
    if (!status.isEligible) {
      throw new ApiError('INVALID_INPUT', 'Wallet not eligible');
    }
    if (!status.hasClaimedLobsters) {
      throw new ApiError('INVALID_INPUT', 'Must claim lobsters first');
    }
    if (status.hasClaimedClaw) {
      throw new ApiError('INVALID_INPUT', '$CLAW already claimed');
    }

    const calldata = buildCalldata(
      addresses.faucet,
      FaucetAbi as any,
      'claimClaw',
    );

    return c.json(singleStep('Claim 7,000 $CLAW from faucet', calldata));
  }),
);
