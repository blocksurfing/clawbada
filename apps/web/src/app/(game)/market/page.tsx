'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, type ListingData, type LobsterData, type LineageNode } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LobsterCard } from '@/components/game/lobster-card';
import { AnimatedLobster } from '@/components/game/animated-lobster';
import { StatPills } from '@/components/game/stat-pills';
import { BodyPartsGrid } from '@/components/game/body-parts-grid';
import { DNAViewer } from '@/components/game/dna-viewer';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { MarketCatalog } from '@/components/market/market-catalog';
import { formatAddress, tierLabel } from '@/lib/format';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { CLASS_CARD_COLORS } from '@/lib/mock-data';
import { Sparkles, ExternalLink, ChevronLeft, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A listing as the detail view draws it: the row from the listings route plus the lobster shape the view expects. */
interface MarketListing {
  listingId: string;
  tokenId: string;
  seller: string;
  price: string;
  listedAt: number;
  lobster: LobsterData;
}

const TIER_COLORS = [
  'bg-slate-500/20 text-slate-300',
  'bg-teal/20 text-teal',
  'bg-ocean/20 text-ocean',
  'bg-claw-gold/20 text-claw-gold',
] as const;

/** The grid row carries class, tier, purity, legend, dna, damage, breeds and generation; the detail view
 *  fetches the rest (stats, genes) from the listing route. */
function toMarketListing(l: ListingData): MarketListing {
  return {
    listingId: l.listingId,
    tokenId: l.tokenId,
    seller: l.seller,
    price: l.price,
    listedAt: l.listedAt,
    lobster: {
      tokenId: l.tokenId,
      owner: l.seller,
      dna: l.dna ?? '0',
      class: l.class ?? 0,
      className: CLASS_NAMES_LIST[l.class ?? 0] ?? 'Unknown',
      classRole: '',
      legend: l.legend ? 1 : 0,
      breedType: 0,
      purity: l.purity ?? 0,
      evolutionTier: l.evolutionTier ?? 0,
      tierName: tierLabel(l.evolutionTier ?? 0),
      damage: l.damage ?? 0,
      breedCount: l.breedCount ?? 0,
      generation: l.generation ?? 0,
      soulbound: false,
      locked: false,
      stats: { hp: '0', attack: '0', armor: '0', speed: '0', critical: '0' },
      bodyParts: [],
    } as LobsterData,
  };
}

/**
 * The Market: Nzib's catalogue (design/website ee1219f) on the real listings, with the detail view and the
 * List dialog kept from before until he designs them. No page header — his `main.js` lists the market with the
 * Shell — and his reserved shopkeeper band stays as a placeholder until the artwork exists.
 */
export default function MarketplacePage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<MarketListing | null>(null);

  const { data: lobstersData } = useQuery({
    queryKey: ['lobsters', address],
    queryFn: () => api.agent.lobsters(address!),
    enabled: !!address,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['listings'] });
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
  };

  const unlockedLobsters = lobstersData?.lobsters.filter((l) => !l.locked && !l.soulbound) ?? [];

  return (
    <div className="market-page">
      <section className="market" data-market aria-label="Marketplace">
        <div className="market-hero" role="img" aria-label="Reserved space for animated shopkeeper artwork">
          <span className="market-hero-placeholder" aria-hidden="true">Shopkeeper artwork</span>
        </div>
        <MarketCatalog
          address={address}
          onOpen={(l) => setExpanded(toMarketListing(l))}
          onChanged={invalidate}
          listAction={address ? <ListLobsterDialog lobsters={unlockedLobsters} onSuccess={invalidate} /> : null}
        />
      </section>

      {/* Expanded detail overlay */}
      {expanded && (
        <ExpandedView
          listing={expanded}
          isOwner={!!address && expanded.seller.toLowerCase() === (address?.toLowerCase() ?? '')}
          onClose={() => setExpanded(null)}
          onAction={invalidate}
        />
      )}
    </div>
  );
}

/* ── Detail view ── */

const CARD_TABS = ['Info', 'Body Parts', 'DNA', 'Lineage', 'History'] as const;
type CardTab = typeof CARD_TABS[number];

const TIER_PROGRESSION = ['Base', 'Evolved', 'Elite', 'Apex'] as const;

function ExpandedView({
  listing,
  isOwner,
  onClose,
  onAction,
}: {
  listing: MarketListing;
  isOwner: boolean;
  onClose: () => void;
  onAction: () => void;
}) {
  const [tab, setTab] = useState<CardTab>('Info');
  // The grid row knows class, tier, purity and legend; the detail route returns the whole lobster
  // (stats, damage, genes), so a buyer sees real numbers instead of zeros.
  const { data: detail } = useQuery({
    queryKey: ['listing', listing.listingId],
    queryFn: () => api.market.getListing(listing.listingId),
  });
  const lobster: LobsterData = detail?.lobster ? { ...listing.lobster, ...detail.lobster } : listing.lobster;
  const classColor = CLASS_CARD_COLORS[lobster.class] ?? '#4682B4';
  const isLegend = lobster.legend > 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-4 md:inset-y-8 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:max-w-4xl md:w-full z-50 flex flex-col">
        <FrostedPanel className="p-0 overflow-hidden flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
            <button onClick={onClose} className="flex items-center gap-1.5 text-text-secondary hover:text-foreground transition-colors">
              <ChevronLeft className="size-5" />
              <span className="text-sm font-medium">Back to Market</span>
            </button>
            <Link
              href={`/lobster/${listing.tokenId}`}
              className="flex items-center gap-1.5 text-sm text-ocean hover:text-ocean/80 transition-colors"
            >
              Full Details <ExternalLink className="size-3.5" />
            </Link>
          </div>

          <div className="md:flex flex-1 min-h-0 overflow-y-auto">
            {/* Left: Character Spotlight */}
            <div className="md:w-[42%] p-6 flex flex-col items-center">
              <div
                className="relative w-full aspect-square max-w-[320px] rounded-xl flex items-center justify-center overflow-hidden mb-5"
                style={{
                  background: `radial-gradient(ellipse at 50% 60%, ${classColor}40 0%, ${classColor}15 50%, transparent 80%)`,
                }}
              >
                <AnimatedLobster
                    dna={lobster.dna}
                    evolutionTier={lobster.evolutionTier}
                    displaySize={320}
                    frameSize={160}
                    frames={16}
                    className="drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)]"
                />
                {isLegend && (
                  <div className="absolute top-3 right-3 bg-claw-gold/90 rounded-md px-2.5 py-1 flex items-center gap-1.5 animate-pulse-glow">
                    <Sparkles className="size-4 text-white" />
                    <span className="text-sm font-bold text-white">Legend</span>
                  </div>
                )}
                {/* Token ID pill */}
                <div className="absolute top-3 left-3">
                  <span className="text-xs font-mono px-2 py-1 rounded-md bg-ocean-deep/70 text-text-secondary backdrop-blur-sm">
                    #{listing.tokenId}
                  </span>
                </div>
              </div>

              {/* Purity stars — prominent */}
              <div className="flex items-center gap-1.5 mb-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'text-xl',
                      i < lobster.purity ? 'text-claw-gold' : 'text-ocean-surface/30',
                    )}
                  >
                    ★
                  </span>
                ))}
                <span className="text-sm text-text-secondary ml-2 font-medium">Purity {lobster.purity}/6</span>
              </div>

              {/* Class + Role */}
              <span
                className="text-base font-bold px-4 py-1.5 rounded-lg mb-2"
                style={{ backgroundColor: `${classColor}25`, color: classColor }}
              >
                {lobster.className} — {lobster.classRole}
              </span>

              {/* Tier + Gen + Breed row */}
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                <span className={cn('text-sm font-bold px-3 py-1 rounded-md', TIER_COLORS[lobster.evolutionTier])}>
                  {tierLabel(lobster.evolutionTier)}
                </span>
                <span className="text-sm px-3 py-1 rounded-md bg-ocean-surface/20 text-text-secondary">
                  Gen {lobster.generation}
                </span>
                <span className="text-sm px-3 py-1 rounded-md bg-ocean-surface/20 text-text-secondary">
                  Breed {lobster.breedCount}/5
                </span>
              </div>
            </div>

            {/* Right: Tabbed Info Panel */}
            <div className="md:w-[58%] border-t md:border-t-0 md:border-l border-border flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-border">
                {CARD_TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      'flex-1 px-4 py-3 text-sm font-medium transition-colors text-center',
                      tab === t
                        ? 'text-claw-gold border-b-2 border-claw-gold'
                        : 'text-text-secondary hover:text-foreground',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-6 flex-1 overflow-y-auto">
                {tab === 'Info' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="font-pixel text-sm text-text-accent mb-3">Stats</h3>
                      <StatPills stats={lobster.stats} />
                    </div>

                    <div>
                      <h3 className="font-pixel text-sm text-text-accent mb-3">Evolution</h3>
                      <div className="flex items-center gap-1">
                        {TIER_PROGRESSION.map((name, i) => (
                          <div key={name} className="flex items-center">
                            <span
                              className={cn(
                                'text-sm px-3 py-1.5 rounded-md font-medium',
                                i === lobster.evolutionTier
                                  ? TIER_COLORS[i]
                                  : i < lobster.evolutionTier
                                    ? 'text-text-secondary/50 line-through'
                                    : 'text-text-secondary/30',
                              )}
                            >
                              {name}
                            </span>
                            {i < 3 && <span className="text-xs mx-0.5 text-text-secondary/20">→</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-pixel text-sm text-text-accent mb-3">About</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-text-secondary">Class</span>
                          <p className="font-medium text-foreground">{lobster.className}</p>
                        </div>
                        <div>
                          <span className="text-text-secondary">Role</span>
                          <p className="font-medium text-foreground">{lobster.classRole}</p>
                        </div>
                        <div>
                          <span className="text-text-secondary">Generation</span>
                          <p className="font-medium text-foreground">{lobster.generation}</p>
                        </div>
                        <div>
                          <span className="text-text-secondary">Breed Count</span>
                          <p className="font-medium text-foreground">{lobster.breedCount} / 5</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'Body Parts' && (
                  <div>
                    <h3 className="font-pixel text-sm text-text-accent mb-3">
                      Body Parts
                      <span className="text-xs text-text-secondary font-sans ml-2">Gold = matches class</span>
                    </h3>
                    <BodyPartsGrid lobsterClass={lobster.class} bodyParts={lobster.bodyParts} />
                  </div>
                )}

                {tab === 'DNA' && (
                  <div>
                    {lobster.bodyParts.length > 0 ? (
                      <DNAViewer bodyParts={lobster.bodyParts} lobsterClass={lobster.class} purity={lobster.purity} />
                    ) : (
                      <p className="text-text-secondary text-center py-8">Genes not loaded yet</p>
                    )}
                  </div>
                )}

                {tab === 'Lineage' && <LineageTab tokenId={listing.tokenId} />}

                {tab === 'History' && (
                  <div className="text-center py-12">
                    <Clock className="size-8 mx-auto mb-3 text-text-secondary/40" />
                    <p className="text-text-secondary font-medium">Trading history coming soon</p>
                    <p className="text-sm text-text-secondary/60 mt-1">Sales, breeds, and evolution records</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sticky footer: always-visible price + Buy/Delist CTA */}
          <div className="shrink-0 border-t border-border bg-ocean-deep/95 backdrop-blur-md px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wider">Price</span>
                  <span className="text-xl sm:text-2xl font-bold text-claw-gold font-mono leading-none">
                    {Number(listing.price).toLocaleString()}
                  </span>
                  <span className="text-xs sm:text-sm text-claw-gold/60 font-mono">$GOLD</span>
                </div>
                <span className="text-[11px] sm:text-xs text-text-secondary truncate">
                  Seller <span className="font-mono">{formatAddress(listing.seller)}</span>
                </span>
              </div>
              <div className="shrink-0">
                {isOwner ? (
                  <TransactionButton
                    label="Delist"
                    variant="outline"
                    size="lg"
                    fetchSteps={(auth) => api.market.delist(listing.listingId, auth)}
                    onSuccess={() => { onClose(); onAction(); }}
                  />
                ) : (
                  <TransactionButton
                    label="Buy Now"
                    size="lg"
                    fetchSteps={(auth) => api.market.buy(listing.listingId, auth)}
                    onSuccess={() => { onClose(); onAction(); }}
                  />
                )}
              </div>
            </div>
          </div>
        </FrostedPanel>
      </div>
    </>
  );
}

/* ── List Lobster Dialog ── */

function ListLobsterDialog({ lobsters, onSuccess }: { lobsters: LobsterData[]; onSuccess: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setSelected(null); setPrice(''); } }}>
      <DialogTrigger asChild>
        <button type="button" className="pixel-button">List a lobster</button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-ocean-deep border-border">
        <DialogHeader>
          <DialogTitle className="font-pixel text-foreground">List a Lobster for Sale</DialogTitle>
        </DialogHeader>
        {!selected ? (
          <>
            <p className="text-text-secondary mb-4">Select a lobster to list:</p>
            {lobsters.length === 0 ? (
              <p className="text-center py-8 text-text-secondary">No eligible lobsters to list.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {lobsters.map((lob) => {
                  const isDamaged = lob.damage > 0;
                  return (
                    <div key={lob.tokenId} className="relative">
                      <LobsterCard
                        tokenId={lob.tokenId}
                        dna={lob.dna}
                        lobsterClass={lob.class}
                        evolutionTier={lob.evolutionTier}
                        purity={lob.purity}
                        legend={lob.legend}
                        damage={lob.damage}
                        locked={lob.locked}
                        soulbound={lob.soulbound}
                        size="sm"
                        className={isDamaged ? 'opacity-40 pointer-events-none' : undefined}
                        onClick={isDamaged ? undefined : () => setSelected(lob.tokenId)}
                      />
                      {isDamaged && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="bg-ocean-deep/90 text-coral text-xs font-bold px-2 py-1 rounded-md">
                            Repair first
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelected(null)}
                className="frosted-panel px-3 py-1.5 text-sm text-text-secondary hover:text-foreground transition-colors"
              >
                Back
              </button>
              <span className="text-foreground font-mono">Listing #{selected}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price" className="text-text-secondary">Price ($GOLD)</Label>
              <Input
                id="price"
                type="number"
                placeholder="e.g. 5000"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="bg-ocean-mid/50 border-border"
              />
            </div>
            <TransactionButton
              label="List for Sale"
              disabled={!price || Number(price) <= 0}
              fetchSteps={(auth) => api.market.list(selected!, price, auth)}
              onSuccess={() => { setOpen(false); setSelected(null); setPrice(''); onSuccess(); }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Lineage: parents and grandparents from the indexer's breed records ── */

function LineageTab({ tokenId }: { tokenId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['lineage', tokenId],
    queryFn: () => api.breeding.lineage(tokenId),
  });
  if (isLoading) return <p className="text-text-secondary text-center py-8">Loading lineage…</p>;
  if (isError || !data) return <p className="text-text-secondary text-center py-8">Lineage unavailable for #{tokenId}.</p>;
  if (data.parents.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary font-medium">Faucet-born — no parents</p>
        <p className="text-sm text-text-secondary/60 mt-1">Generation {data.generation}. Its own offspring will show it as a parent.</p>
      </div>
    );
  }
  const grandparents = data.parents.flatMap((p) => p.parents);
  return (
    <div className="space-y-6">
      <LineageRow title="Parents" nodes={data.parents} />
      {grandparents.length > 0 && <LineageRow title="Grandparents" nodes={grandparents} />}
      <p className="text-xs text-text-secondary/60">Generation {data.generation}. Lineage comes from the breed records the game indexes; faucet-born ancestors end a branch.</p>
    </div>
  );
}

function LineageRow({ title, nodes }: { title: string; nodes: LineageNode[] }) {
  return (
    <div>
      <h3 className="font-pixel text-sm text-text-accent mb-3">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {nodes.map((n) => (
          <Link key={n.tokenId} href={`/lobster/${n.tokenId}`} className="frosted-panel p-3 flex flex-col items-center gap-2 hover:border-[rgba(255,210,128,0.35)] transition-colors">
            <AnimatedLobster dna={n.dna} evolutionTier={n.evolutionTier} displaySize={96} frameSize={80} frames={16} />
            <span className="text-sm font-medium text-foreground">#{n.tokenId} {CLASS_NAMES_LIST[n.class] ?? ''}</span>
            <span className="text-xs text-text-secondary text-center">{tierLabel(n.evolutionTier)} · Gen {n.generation} · purity {n.purity}/6{n.legend ? ' · Legend' : ''}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
