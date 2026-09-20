import { Hono } from 'hono';
import { FaucetAbi, addresses } from '@clawbada/chain';
import { walletAuth } from '../middleware/auth';
import { catchErrors, ApiError } from '../lib/errors';
import { readBlockNumber, readFaucetStatus, serializeBigInts } from '../lib/chain';
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
      // D-10: the drip is for wallets that HOLD their lobsters — the claim must be finalized.
      canClaimClaw: status.isOpen && status.isEligible && status.hasClaimedLobsters && !status.lobsterClaimPending && !status.hasClaimedClaw,
      canFinalizeLobsters: status.lobsterClaimPending,
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

    // D-10: this transaction COMMITS the claim; it mints nothing. The five lobsters are rolled from
    // the hash of a block two blocks later — one that does not exist yet, so the roll cannot be
    // known or retried — and minted by finalizeClaim. The engine's keeper sends that within a
    // few seconds; poll GET /status/:address until `lobsterClaimPending` is false.
    return c.json({
      ...singleStep('Claim 5 soulbound lobsters from the faucet (they arrive a few seconds later)', calldata),
      next: { poll: `/api/faucet/status/${address}`, until: 'lobsterClaimPending === false', fallback: '/api/faucet/finalize-lobsters' },
    });
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
    if (status.lobsterClaimPending) {
      throw new ApiError('INVALID_INPUT', 'Your lobsters have not been minted yet — wait a few seconds, or call /api/faucet/finalize-lobsters');
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


// POST /api/faucet/finalize-lobsters — D-10 self-service fallback.
// finalizeClaim is permissionless and mints to the original claimer, so the engine's keeper
// normally sends it. If the keeper is down, a wallet is not stuck: this returns the calldata to
// finish its own claim. When the target block's hash has aged out of reach, the claim is
// re-armed first (a NEW future block — nothing is lost) and finalized a few seconds later.
faucetRoutes.post(
  '/finalize-lobsters',
  walletAuth,
  catchErrors(async (c) => {
    const address = c.get('address') as string;
    const status = await readFaucetStatus(address);
    if (!status.lobsterClaimPending) {
      throw new ApiError('INVALID_INPUT', status.lobsterClaimId > 0n ? 'Your lobsters are already minted' : 'No lobster claim to finalize — claim first');
    }

    const head = await readBlockNumber();
    if (head <= status.lobsterClaimTargetBlock) {
      throw new ApiError('COOLDOWN_ACTIVE', `Too early: the claim finalizes after block ${status.lobsterClaimTargetBlock} (now ${head})`);
    }
    // Past the 256-block blockhash window the contract may still find the hash in the EIP-2935
    // history contract; it decides. Offer finalize inside the native window, re-arm beyond it.
    const expired = head - status.lobsterClaimTargetBlock > 256n;
    const fn = expired ? 'rearmClaim' : 'finalizeClaim';
    const calldata = buildCalldata(addresses.faucet, FaucetAbi as any, fn, [status.lobsterClaimId]);
    return c.json({
      ...singleStep(expired ? 'Re-arm your lobster claim (its block hash expired) — then finalize again in a few seconds' : 'Mint your 5 faucet lobsters', calldata),
      action: fn,
    });
  }),
);
