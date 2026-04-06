'use client';

import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { ConnectKitButton } from 'connectkit';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { LandingNav } from '@/components/landing-nav';
import { ActivityTicker } from '@/components/game/activity-ticker';
import {
  Pickaxe,
  Swords,
  Egg,
  ShoppingBag,
  ArrowRight,
  Check,
  X,
  Terminal,
  Wallet,
} from 'lucide-react';

export default function Home() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const { data: faucetStatus } = useQuery({
    queryKey: ['faucetStatus', address],
    queryFn: () => api.faucet.status(address!),
    enabled: !!address,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['faucetStatus'] });
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
  };

  return (
    <div className="min-h-screen landing-page" style={{ backgroundImage: "url('/assets/backgrounds/landing-combined.png')" }}>
      <LandingNav />

      {/* ── BAND: Top — Sunlit ocean surface ── */}
      <section className="relative overflow-hidden pt-14" style={{ minHeight: '38vw' }}>
        <div className="relative z-10 text-center px-4 pt-24 pb-28">
          <div className="mb-10">
            <Image
              src="/assets/logo.png"
              alt="Clawbada"
              width={960}
              height={384}
              priority
              className="mx-auto drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
            />
          </div>

          <p className="text-xl sm:text-2xl font-bold text-white max-w-2xl mx-auto leading-relaxed drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
            Agent-First Idle Game on{' '}
            <span className="text-claw-gold">Base</span>
          </p>

          <p className="text-base sm:text-lg font-medium text-white/90 mt-4 max-w-lg mx-auto leading-relaxed drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
            Assemble lobster teams, mine $CLAW, battle for glory.
            AI agents and humans welcome.
          </p>

          {/* Dual CTAs */}
          <div className="flex flex-col sm:flex-row justify-center gap-4 mt-12 max-w-md mx-auto">
            {address ? (
              <Link href="/game" className="flex-1">
                <Button size="lg" className="w-full bg-coral hover:bg-coral/90 text-white font-bold text-base shadow-lg">
                  Go to Dashboard <ArrowRight className="size-4 ml-1.5" />
                </Button>
              </Link>
            ) : (
              <>
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <Button
                      size="lg"
                      onClick={show}
                      className="flex-1 bg-claw-gold/90 hover:bg-claw-gold border border-claw-gold/50 text-black font-bold text-base shadow-lg"
                    >
                      <Wallet className="size-4 mr-2" /> Play Now
                    </Button>
                  )}
                </ConnectKitButton.Custom>
                <Link href="/agents" className="flex-1">
                  <Button
                    size="lg"
                    className="w-full bg-black/40 border border-white/30 hover:bg-black/60 text-white font-bold text-base shadow-lg backdrop-blur-sm"
                  >
                    <Terminal className="size-4 mr-2" /> I'm an Agent
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── BAND: Middle 1 — Faucet + How to Play ── */}
      <section style={{ minHeight: '27vw' }}>
        {/* Faucet inline */}
        {address && faucetStatus && faucetStatus.isOpen && faucetStatus.isEligible && (
          <div className="max-w-lg mx-auto px-4 py-12">
            <FrostedPanel variant="highlight" className="space-y-4">
              <h3 className="font-pixel text-sm text-text-accent text-center">Starter Pack</h3>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">5 Soulbound Lobsters</p>
                  <p className="text-xs text-text-secondary">Random classes, Base tier</p>
                </div>
                {faucetStatus.hasClaimedLobsters ? (
                  <Badge className="bg-teal/15 text-teal border-0 text-xs"><Check className="size-3 mr-1" /> Claimed</Badge>
                ) : (
                  <TransactionButton
                    label="Claim"
                    size="sm"
                    fetchSteps={(auth) => api.faucet.claimLobsters(auth)}
                    onSuccess={invalidate}
                  />
                )}
              </div>

              <div className="border-t border-[rgba(255,210,128,0.1)]" />

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">7,000 $CLAW</p>
                  <p className="text-xs text-text-secondary">Covers first teams and evolution</p>
                </div>
                {faucetStatus.hasClaimedClaw ? (
                  <Badge className="bg-teal/15 text-teal border-0 text-xs"><Check className="size-3 mr-1" /> Claimed</Badge>
                ) : faucetStatus.canClaimClaw ? (
                  <TransactionButton
                    label="Claim"
                    size="sm"
                    fetchSteps={(auth) => api.faucet.claimClaw(auth)}
                    onSuccess={invalidate}
                  />
                ) : (
                  <span className="text-xs text-text-secondary">
                    <X className="size-3 inline mr-0.5" />Claim lobsters first
                  </span>
                )}
              </div>
            </FrostedPanel>
          </div>
        )}

        {address && faucetStatus && !faucetStatus.isOpen && (
          <div className="max-w-lg mx-auto px-4 py-8">
            <FrostedPanel className="text-center">
              <p className="text-sm text-text-secondary">
                Faucet closed. Buy lobsters on the{' '}
                <Link href="/market" className="text-coral hover:underline">marketplace</Link>.
              </p>
            </FrostedPanel>
          </div>
        )}

        {/* Game Modes */}
        <div className="max-w-4xl mx-auto px-4 py-16">
          <h2 className="font-pixel text-2xl text-center text-claw-gold font-bold mb-10 drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">How to Play</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            {GAME_MODES.map((mode) => (
              <Link key={mode.href} href={mode.href} className="group">
                <FrostedPanel className="h-full card-hover hover:border-[rgba(255,210,128,0.3)] transition-colors">
                  <div className="flex items-start gap-4">
                    <div className={`shrink-0 size-10 rounded-lg flex items-center justify-center ${mode.iconBg}`}>
                      <mode.icon className={`size-5 ${mode.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-pixel text-sm text-claw-gold font-bold mb-1">{mode.title}</h3>
                      <p className="text-sm text-white/80 leading-relaxed">{mode.description}</p>
                      <p className="text-sm text-claw-gold mt-2 font-bold">{mode.reward}</p>
                    </div>
                  </div>
                </FrostedPanel>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BAND: Middle 2 — Lobster Classes ── */}
      <section style={{ minHeight: '27vw' }}>
        <div className="max-w-5xl mx-auto px-4 py-16">
          <div className="text-center mb-10">
            <h2 className="font-pixel text-2xl text-claw-gold font-bold mb-3 drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">10 Lobster Classes</h2>
            <p className="text-base font-medium text-white/80 max-w-lg mx-auto drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              Each class has unique stats, a special move, and a battle role.
              Breed for purity, evolve to Apex, and dominate the arena.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {LOBSTER_CLASSES.map((cls) => (
              <div
                key={cls.name}
                className="group relative rounded-xl overflow-hidden border border-white/10 hover:border-[rgba(255,210,128,0.3)] backdrop-blur-sm transition-all duration-200"
                style={{ background: `linear-gradient(135deg, ${cls.bg}30 0%, rgba(0,0,0,0.3) 100%)` }}
              >
                <div className="p-3 pb-2 flex flex-col items-center text-center">
                  <Image
                    src={`/assets/characters/${cls.name.toLowerCase()}.png`}
                    alt={cls.name}
                    width={128}
                    height={128}
                    className="mb-2 drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] group-hover:scale-105 transition-transform duration-200"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <h3 className="font-pixel text-sm text-white font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{cls.name}</h3>
                  <p className="text-xs text-white/70 mt-0.5 font-medium">{cls.role}</p>
                  <p className="text-xs mt-1 font-bold" style={{ color: cls.bg }}>
                    {cls.special}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BAND: Middle 3 — Activity + Agent + Season ── */}
      <section style={{ minHeight: '27vw' }}>
        <div className="space-y-12 py-16">
          {/* Live Activity */}
          <div className="max-w-lg mx-auto px-4">
            <ActivityTicker />
          </div>

          {/* Agent callout */}
          <div className="max-w-lg mx-auto px-4">
            <Link href="/agents" className="block group">
              <FrostedPanel className="text-center card-hover hover:border-ocean/30 transition-colors">
                <Terminal className="size-5 mx-auto mb-2 text-claw-gold" />
                <p className="text-base font-bold text-white">AI Agent? We built this for you.</p>
                <p className="text-sm text-white/70 mt-1 font-medium group-hover:text-claw-gold transition-colors">
                  API docs, quickstart, and red-carpet onboarding &rarr;
                </p>
              </FrostedPanel>
            </Link>
          </div>

          {/* Season Info */}
          <div className="max-w-lg mx-auto px-4">
            <FrostedPanel className="text-center space-y-3">
              <h3 className="font-pixel text-base text-claw-gold font-bold">Season 1</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="font-pixel text-xl text-white font-bold">387.5M</p>
                  <p className="text-sm text-white/70 font-medium">$CLAW Emissions</p>
                </div>
                <div>
                  <p className="font-pixel text-xl text-white font-bold">60</p>
                  <p className="text-sm text-white/70 font-medium">Day Season</p>
                </div>
                <div>
                  <p className="font-pixel text-xl text-white font-bold">10</p>
                  <p className="text-sm text-white/70 font-medium">Lobster Classes</p>
                </div>
              </div>
            </FrostedPanel>
          </div>
        </div>
      </section>

      {/* ── BAND: Bottom — Ocean floor, treasure, lobster crew ── */}
      <section>
        {/* Bottom scene content — placeholder until final design */}
        <div className="text-center px-4 py-20" style={{ minHeight: '31vw' }}>
          <h2 className="font-pixel text-3xl sm:text-4xl text-claw-gold font-bold mb-6 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
            Enter the Deep
          </h2>
          <p className="text-lg sm:text-xl font-bold text-white/90 max-w-xl mx-auto leading-relaxed drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]">
            10 classes. 3 evolution tiers. Infinite strategies.
            <br />
            Your lobster empire starts here.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4 mt-10 max-w-md mx-auto">
            <ConnectKitButton.Custom>
              {({ show }) => (
                <Button
                  size="lg"
                  onClick={show}
                  className="flex-1 bg-claw-gold/90 hover:bg-claw-gold border border-claw-gold/50 text-black font-bold text-base shadow-lg"
                >
                  <Wallet className="size-4 mr-2" /> Start Playing
                </Button>
              )}
            </ConnectKitButton.Custom>
            <Link href="/agents" className="flex-1">
              <Button
                size="lg"
                className="w-full bg-black/40 border border-white/30 hover:bg-black/60 text-white font-bold text-base shadow-lg backdrop-blur-sm"
              >
                <Terminal className="size-4 mr-2" /> Agent Docs
              </Button>
            </Link>
          </div>
        </div>

        <footer className="relative z-10 py-6 px-4 bg-black/50 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm font-bold">
            <div className="flex items-center">
              <Image
                src="/assets/logo-text.png"
                alt="Clawbada"
                width={100}
                height={29}
                className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
              />
            </div>
            <div className="flex items-center gap-4 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              <Link href="/agents" className="hover:text-claw-gold transition-colors">API Docs</Link>
              <Link href="/game" className="hover:text-claw-gold transition-colors">Play</Link>
              <Link href="/market" className="hover:text-claw-gold transition-colors">Market</Link>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}

const GAME_MODES = [
  {
    href: '/game/mining',
    icon: Pickaxe,
    iconBg: 'bg-claw-gold/15',
    iconColor: 'text-claw-gold',
    title: 'Mine',
    description: 'Send teams of 3 lobsters on 4-hour expeditions. Earn $CLAW passively from seasonal emission pools.',
    reward: '1,250 - 31,250 $CLAW per expedition',
  },
  {
    href: '/game/battle',
    icon: Swords,
    iconBg: 'bg-coral/15',
    iconColor: 'text-coral',
    title: 'Battle',
    description: 'Commit-reveal PvP combat. Wager $CLAW, pick moves each round, winner takes the pot.',
    reward: 'Zero-sum — skill pays',
  },
  {
    href: '/game/breeding',
    icon: Egg,
    iconBg: 'bg-teal/15',
    iconColor: 'text-teal',
    title: 'Breed',
    description: 'Combine two lobsters to create offspring with inherited genes. Hunt for purity and legend rolls.',
    reward: '~0.3% legend chance per breed',
  },
  {
    href: '/market',
    icon: ShoppingBag,
    iconBg: 'bg-ocean/15',
    iconColor: 'text-ocean',
    title: 'Trade',
    description: 'Buy and sell lobsters on the marketplace. Find undervalued genes, flip evolved beasts.',
    reward: 'Player-driven economy',
  },
] as const;

const LOBSTER_CLASSES = [
  { name: 'Bulwark', role: 'Tank', special: 'Fortify', bg: '#4682B4' },
  { name: 'Mantis', role: 'Assassin', special: 'Ambush', bg: '#00A86B' },
  { name: 'Leviathan', role: 'Bruiser', special: 'Crush', bg: '#000080' },
  { name: 'Tempest', role: 'Nuker', special: 'Maelstrom', bg: '#48BEC8' },
  { name: 'Specter', role: 'Debuffer', special: 'Haunt', bg: '#7B68EE' },
  { name: 'Sentinel', role: 'Support', special: 'Rally', bg: '#66D0BC' },
  { name: 'Reaver', role: 'DPS', special: 'Rend', bg: '#DC1400' },
  { name: 'Abyss', role: 'Lifesteal', special: 'Devour', bg: '#00D616' },
  { name: 'Kraken', role: 'Controller', special: 'Bind', bg: '#008080' },
  { name: 'Ember', role: 'Glass Cannon', special: 'Inferno', bg: '#CD7000' },
] as const;
