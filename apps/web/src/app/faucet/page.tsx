'use client';

import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ConnectKitButton } from 'connectkit';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { LandingNav } from '@/components/landing-nav';
import { BACKGROUNDS } from '@/lib/assets';
import { Check, X, ArrowRight, Droplets } from 'lucide-react';

export default function FaucetPage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const { data: faucetStatus, isLoading } = useQuery({
    queryKey: ['faucetStatus', address],
    queryFn: () => api.faucet.status(address!),
    enabled: !!address,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['faucetStatus'] });
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
  };

  const bothClaimed = faucetStatus?.hasClaimedLobsters && faucetStatus?.hasClaimedClaw;

  return (
    <div className="min-h-screen bg-ocean-deep">
      <LandingNav />

      <PageBackground variant="shallow" scene={BACKGROUNDS.faucet}>
        <section className="max-w-md mx-auto px-4 pt-28 pb-20">
          <div className="text-center mb-8">
            <div className="size-14 rounded-full bg-ocean/15 flex items-center justify-center mx-auto mb-4">
              <Droplets className="size-7 text-ocean" />
            </div>
            <h1 className="font-pixel text-2xl text-foreground">Faucet</h1>
            <p className="text-sm text-text-secondary mt-2">
              Get your starting lobsters and $CLAW to begin playing
            </p>
          </div>

          {!address ? (
            <FrostedPanel className="text-center space-y-4">
              <p className="text-sm text-text-secondary">Connect your wallet to check eligibility.</p>
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <Button onClick={show} size="lg" className="bg-coral hover:bg-coral/90 text-white">
                    Connect Wallet
                  </Button>
                )}
              </ConnectKitButton.Custom>
            </FrostedPanel>
          ) : isLoading ? (
            <FrostedPanel className="text-center">
              <p className="text-sm text-text-secondary animate-pulse">Checking eligibility...</p>
            </FrostedPanel>
          ) : !faucetStatus ? (
            <FrostedPanel className="text-center">
              <p className="text-sm text-text-secondary">Unable to check faucet status.</p>
            </FrostedPanel>
          ) : !faucetStatus.isOpen ? (
            <FrostedPanel className="text-center space-y-3">
              <p className="font-pixel text-sm text-foreground">Faucet Closed</p>
              <p className="text-sm text-text-secondary">
                The faucet has closed. You can buy lobsters on the marketplace and $CLAW on Uniswap.
              </p>
              <Link href="/market">
                <Button size="sm" className="bg-sand hover:bg-sand-light text-foreground border border-[rgba(255,210,128,0.15)]">
                  Go to Marketplace <ArrowRight className="size-3.5 ml-1" />
                </Button>
              </Link>
            </FrostedPanel>
          ) : !faucetStatus.isEligible ? (
            <FrostedPanel className="text-center space-y-3">
              <p className="font-pixel text-sm text-foreground">Not Eligible</p>
              <p className="text-sm text-text-secondary">
                {faucetStatus.reason ?? 'Your wallet must hold \u2265 0.001 ETH, be \u2265 7 days old on Base, and have \u2265 3 prior transactions.'}
              </p>
            </FrostedPanel>
          ) : (
            <div className="space-y-4">
              {/* Eligibility badge */}
              <FrostedPanel variant="highlight" className="py-3">
                <div className="flex items-center gap-2">
                  <Check className="size-4 text-teal" />
                  <span className="text-sm font-medium text-teal">Eligible</span>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  Your wallet meets all requirements. Claim your starter pack below.
                </p>
              </FrostedPanel>

              {/* Step 1: Lobsters */}
              <FrostedPanel className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Step 1: Claim 5 Lobsters</p>
                    <p className="text-xs text-text-secondary mt-0.5">5 random soulbound lobsters (Base tier)</p>
                  </div>
                  {faucetStatus.hasClaimedLobsters ? (
                    <Badge className="bg-teal/15 text-teal border-0">
                      <Check className="size-3 mr-1" /> Claimed
                    </Badge>
                  ) : (
                    <TransactionButton
                      label="Claim Lobsters"
                      size="sm"
                      fetchSteps={(auth) => api.faucet.claimLobsters(auth)}
                      onSuccess={invalidate}
                    />
                  )}
                </div>
              </FrostedPanel>

              {/* Step 2: $CLAW */}
              <FrostedPanel className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Step 2: Claim 7,000 $CLAW</p>
                    <p className="text-xs text-text-secondary mt-0.5">Covers teams, first breed, first evolution</p>
                  </div>
                  {faucetStatus.hasClaimedClaw ? (
                    <Badge className="bg-teal/15 text-teal border-0">
                      <Check className="size-3 mr-1" /> Claimed
                    </Badge>
                  ) : faucetStatus.canClaimClaw ? (
                    <TransactionButton
                      label="Claim $CLAW"
                      size="sm"
                      fetchSteps={(auth) => api.faucet.claimClaw(auth)}
                      onSuccess={invalidate}
                    />
                  ) : (
                    <span className="text-xs text-text-secondary">
                      <X className="size-3 inline mr-0.5" /> Claim lobsters first
                    </span>
                  )}
                </div>
              </FrostedPanel>

              {/* Success state */}
              {bothClaimed && (
                <FrostedPanel variant="highlight" className="text-center space-y-3">
                  <p className="font-pixel text-sm text-foreground">You're all set!</p>
                  <p className="text-sm text-text-secondary">
                    Build a team of 3 and start mining.
                  </p>
                  <Link href="/game">
                    <Button className="bg-coral hover:bg-coral/90 text-white">
                      Go to Dashboard <ArrowRight className="size-4 ml-1" />
                    </Button>
                  </Link>
                </FrostedPanel>
              )}
            </div>
          )}
        </section>
      </PageBackground>
    </div>
  );
}
