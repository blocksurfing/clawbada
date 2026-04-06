'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { api, type MarketFilters, type LobsterData } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LobsterCard } from '@/components/game/lobster-card';
import { StatPills } from '@/components/game/stat-pills';
import { BodyPartsGrid } from '@/components/game/body-parts-grid';
import { DNAViewer } from '@/components/game/dna-viewer';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatClaw, formatAddress, tierLabel } from '@/lib/format';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { MOCK_LISTINGS, classImagePath, marketLobsterImage, CLASS_CARD_COLORS, type MockListing } from '@/lib/mock-data';
import { Store, SlidersHorizontal, X, Sparkles, ExternalLink, ChevronLeft, Egg, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const TIER_COLORS = [
  'bg-slate-500/20 text-slate-300',
  'bg-teal/20 text-teal',
  'bg-ocean/20 text-ocean',
  'bg-claw-gold/20 text-claw-gold',
] as const;

export default function MarketplacePage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<MockListing | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'lobster' | 'egg'>('all');
  const [page, setPage] = useState(0);
  const perPage = 18;

  const [filters, setFilters] = useState<MarketFilters>({ sort: 'recent', limit: 24 });

  const { data: listingsData } = useQuery({
    queryKey: ['listings', filters],
    queryFn: () => api.market.listings(filters),
    refetchInterval: 30_000,
  });

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

  // Use mock data as fallback when API returns nothing
  const apiListings = listingsData?.listings ?? [];
  const useMock = apiListings.length === 0;

  // Apply filters to mock data client-side
  let displayListings: MockListing[] = useMock
    ? MOCK_LISTINGS.filter((ml) => {
        if (typeFilter === 'lobster' && ml.isEgg) return false;
        if (typeFilter === 'egg' && !ml.isEgg) return false;
        if (!ml.isEgg) {
          if (filters.class != null && ml.lobster.class !== filters.class) return false;
          if (filters.tier != null && ml.lobster.evolutionTier !== filters.tier) return false;
          if (filters.legend === true && ml.lobster.legend === 0) return false;
          if (filters.minPurity != null && ml.lobster.purity < filters.minPurity) return false;
        }
        if (filters.minPrice != null && Number(ml.price) < filters.minPrice) return false;
        if (filters.maxPrice != null && Number(ml.price) > filters.maxPrice) return false;
        return true;
      })
    : apiListings.map((l) => ({
        ...l,
        isEgg: false,
        lobster: {
          tokenId: l.tokenId,
          owner: l.seller,
          dna: '0',
          class: l.class ?? 0,
          className: CLASS_NAMES_LIST[l.class ?? 0] ?? 'Unknown',
          classRole: '',
          legend: l.legend ? 1 : 0,
          breedType: 0,
          purity: l.purity ?? 0,
          evolutionTier: l.evolutionTier ?? 0,
          tierName: tierLabel(l.evolutionTier ?? 0),
          damage: 0,
          breedCount: 0,
          generation: 0,
          soulbound: false,
          locked: false,
          stats: { hp: '0', attack: '0', armor: '0', speed: '0', critical: '0' },
          bodyParts: [],
        } as LobsterData,
      }));

  // Sort mock data
  if (useMock && filters.sort === 'price_asc') {
    displayListings = [...displayListings].sort((a, b) => Number(a.price) - Number(b.price));
  } else if (useMock && filters.sort === 'price_desc') {
    displayListings = [...displayListings].sort((a, b) => Number(b.price) - Number(a.price));
  }

  // Pagination
  const totalListings = displayListings.length;
  const totalPages = Math.ceil(totalListings / perPage);
  const safePage = Math.min(page, Math.max(totalPages - 1, 0));
  const pagedListings = displayListings.slice(safePage * perPage, (safePage + 1) * perPage);

  // Reset page when filters change
  const filterKey = `${typeFilter}-${filters.class}-${filters.tier}-${filters.legend}-${filters.minPurity}-${filters.minPrice}-${filters.maxPrice}-${filters.sort}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    if (page !== 0) setPage(0);
  }

  const activeFilterCount = [
    typeFilter !== 'all',
    filters.class != null,
    filters.tier != null,
    filters.legend != null,
    filters.minPurity != null,
    filters.minPrice != null || filters.maxPrice != null,
  ].filter(Boolean).length;

  const filterPanel = (
    <div className="space-y-5">
      {/* Type filter */}
      <div className="space-y-2">
        <label className="font-pixel text-xs text-text-accent uppercase tracking-wider">Type</label>
        <div className="flex flex-wrap gap-1.5">
          {([['all', 'All'], ['lobster', 'Lobsters'], ['egg', 'Eggs']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setTypeFilter(val)}
              className={cn(
                'text-sm px-2.5 py-1.5 rounded-md transition-colors font-medium flex items-center gap-1.5',
                typeFilter === val
                  ? 'bg-coral/20 text-coral'
                  : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
              )}
            >
              {val === 'egg' && <Egg className="size-3.5" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div className="space-y-2">
        <label className="font-pixel text-xs text-text-accent uppercase tracking-wider">Sort By</label>
        <Select
          value={filters.sort ?? 'recent'}
          onValueChange={(v) => setFilters((f) => ({ ...f, sort: v as MarketFilters['sort'] }))}
        >
          <SelectTrigger className="bg-ocean-mid/50 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most Recent</SelectItem>
            <SelectItem value="price_asc">Price: Low to High</SelectItem>
            <SelectItem value="price_desc">Price: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Class filter */}
      <div className="space-y-2">
        <label className="font-pixel text-xs text-text-accent uppercase tracking-wider">Class</label>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setFilters((f) => ({ ...f, class: undefined }))}
            className={cn(
              'text-sm px-2.5 py-1.5 rounded-md transition-colors font-medium',
              filters.class == null
                ? 'bg-coral/20 text-coral'
                : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
            )}
          >
            All
          </button>
          {CLASS_NAMES_LIST.map((name, i) => (
            <button
              key={i}
              onClick={() => setFilters((f) => ({ ...f, class: f.class === i ? undefined : i }))}
              className={cn(
                'text-sm px-2.5 py-1.5 rounded-md transition-colors text-left font-medium flex items-center gap-2',
                filters.class === i
                  ? 'bg-coral/20 text-coral'
                  : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
              )}
            >
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: CLASS_CARD_COLORS[i] }}
              />
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Tier filter */}
      <div className="space-y-2">
        <label className="font-pixel text-xs text-text-accent uppercase tracking-wider">Tier</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilters((f) => ({ ...f, tier: undefined }))}
            className={cn(
              'text-sm px-3 py-1.5 rounded-md transition-colors font-medium',
              filters.tier == null
                ? 'bg-ocean/20 text-ocean'
                : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
            )}
          >
            All
          </button>
          {[0, 1, 2, 3].map((t) => (
            <button
              key={t}
              onClick={() => setFilters((f) => ({ ...f, tier: f.tier === t ? undefined : t }))}
              className={cn(
                'text-sm px-3 py-1.5 rounded-md transition-colors font-medium',
                filters.tier === t
                  ? TIER_COLORS[t]
                  : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
              )}
            >
              {tierLabel(t)}
            </button>
          ))}
        </div>
      </div>

      {/* Purity filter */}
      <div className="space-y-2">
        <label className="font-pixel text-xs text-text-accent uppercase tracking-wider">Min Purity</label>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => setFilters((f) => ({ ...f, minPurity: undefined }))}
            className={cn(
              'text-sm px-2 py-1.5 rounded-md transition-colors font-medium',
              filters.minPurity == null
                ? 'bg-claw-gold/20 text-claw-gold'
                : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
            )}
          >
            Any
          </button>
          {[3, 4, 5, 6].map((p) => (
            <button
              key={p}
              onClick={() => setFilters((f) => ({ ...f, minPurity: f.minPurity === p ? undefined : p }))}
              className={cn(
                'text-sm px-2 py-1.5 rounded-md transition-colors font-medium',
                filters.minPurity === p
                  ? 'bg-claw-gold/20 text-claw-gold'
                  : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
              )}
            >
              {p}★
            </button>
          ))}
        </div>
      </div>

      {/* Price range */}
      <div className="space-y-2">
        <label className="font-pixel text-xs text-text-accent uppercase tracking-wider">Price Range</label>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Min"
            value={filters.minPrice ?? ''}
            onChange={(e) => setFilters((f) => ({
              ...f,
              minPrice: e.target.value ? Number(e.target.value) : undefined,
            }))}
            className="bg-ocean-mid/50 border-border text-sm"
          />
          <Input
            type="number"
            placeholder="Max"
            value={filters.maxPrice ?? ''}
            onChange={(e) => setFilters((f) => ({
              ...f,
              maxPrice: e.target.value ? Number(e.target.value) : undefined,
            }))}
            className="bg-ocean-mid/50 border-border text-sm"
          />
        </div>
      </div>

      {/* Legend toggle */}
      <div className="space-y-2">
        <label className="font-pixel text-xs text-text-accent uppercase tracking-wider">Rarity</label>
        <div className="flex gap-1.5">
          <button
            onClick={() => setFilters((f) => ({ ...f, legend: undefined }))}
            className={cn(
              'text-sm px-3 py-1.5 rounded-md transition-colors font-medium',
              filters.legend == null
                ? 'bg-claw-gold/20 text-claw-gold'
                : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
            )}
          >
            All
          </button>
          <button
            onClick={() => setFilters((f) => ({ ...f, legend: f.legend === true ? undefined : true }))}
            className={cn(
              'text-sm px-3 py-1.5 rounded-md transition-colors font-medium flex items-center gap-1.5',
              filters.legend === true
                ? 'bg-claw-gold/20 text-claw-gold'
                : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
            )}
          >
            <Sparkles className="size-3.5" /> Legends
          </button>
        </div>
      </div>

      {/* Clear all */}
      {activeFilterCount > 0 && (
        <button
          onClick={() => setFilters({ sort: filters.sort, limit: 24 })}
          className="text-sm text-text-secondary hover:text-coral transition-colors font-medium"
        >
          Clear filters ({activeFilterCount})
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen landing-page" style={{ backgroundImage: "url('/assets/backgrounds/landing-combined.png')" }}>
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Store className="size-6 text-claw-gold" />
              <h1 className="font-pixel text-2xl text-foreground">Marketplace</h1>
            </div>
            <p className="text-text-secondary mt-1">
              {totalListings} lobster{totalListings !== 1 ? 's' : ''} for sale
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile filter toggle */}
            <button
              onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
              className="md:hidden frosted-panel px-3 py-2 text-sm text-text-secondary flex items-center gap-1.5"
            >
              <SlidersHorizontal className="size-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-coral text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {address && (
              <ListLobsterDialog lobsters={unlockedLobsters} onSuccess={invalidate} />
            )}
          </div>
        </div>

        {/* Mobile filters drawer */}
        {mobileFiltersOpen && (
          <div className="md:hidden mb-4">
            <FrostedPanel className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-pixel text-sm text-text-accent">Filters</span>
                <button onClick={() => setMobileFiltersOpen(false)}>
                  <X className="size-5 text-text-secondary" />
                </button>
              </div>
              {filterPanel}
            </FrostedPanel>
          </div>
        )}

        {/* Main layout: sidebar + grid */}
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden md:block w-[260px] shrink-0">
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto scrollbar-hide">
              <FrostedPanel className="p-6">
                {filterPanel}
              </FrostedPanel>
            </div>
          </aside>

          {/* Listings grid */}
          <div className="flex-1 min-w-0">
            {displayListings.length === 0 ? (
              <FrostedPanel className="py-16 text-center">
                <Image
                  src="/assets/characters/kraken.png"
                  alt="No listings"
                  width={128}
                  height={128}
                  className="mx-auto mb-4 opacity-60"
                  style={{ imageRendering: 'pixelated' }}
                />
                <p className="text-lg font-medium text-foreground mb-1">No lobsters listed yet</p>
                <p className="text-text-secondary mb-4">Be the first to list a lobster for sale!</p>
                {address && (
                  <ListLobsterDialog lobsters={unlockedLobsters} onSuccess={invalidate} />
                )}
              </FrostedPanel>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
                  {pagedListings.map((listing) => (
                    <MarketCard
                      key={listing.listingId}
                      listing={listing}
                      isOwner={!!address && listing.seller.toLowerCase() === address.toLowerCase()}
                      onClick={() => setExpanded(listing)}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-8">
                    <button
                      onClick={() => { setPage(Math.max(0, safePage - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={safePage === 0}
                      className={cn(
                        'frosted-panel px-4 py-2 text-sm font-medium transition-colors',
                        safePage === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:border-[rgba(255,210,128,0.3)] cursor-pointer',
                      )}
                    >
                      Previous
                    </button>

                    <div className="flex items-center gap-1.5">
                      {Array.from({ length: totalPages }, (_, i) => {
                        // Show first, last, and pages around current
                        const show = i === 0 || i === totalPages - 1 || Math.abs(i - safePage) <= 2;
                        const showEllipsis = !show && (i === 1 || i === totalPages - 2);
                        if (showEllipsis) return <span key={i} className="text-text-secondary px-1">...</span>;
                        if (!show) return null;
                        return (
                          <button
                            key={i}
                            onClick={() => { setPage(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            className={cn(
                              'w-9 h-9 rounded-md text-sm font-medium transition-colors',
                              i === safePage
                                ? 'bg-coral/20 text-coral border border-coral/30'
                                : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/30',
                            )}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => { setPage(Math.min(totalPages - 1, safePage + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={safePage >= totalPages - 1}
                      className={cn(
                        'frosted-panel px-4 py-2 text-sm font-medium transition-colors',
                        safePage >= totalPages - 1 ? 'opacity-40 cursor-not-allowed' : 'hover:border-[rgba(255,210,128,0.3)] cursor-pointer',
                      )}
                    >
                      Next
                    </button>
                  </div>
                )}

                <p className="text-center text-sm text-text-secondary mt-3">
                  Showing {safePage * perPage + 1}-{Math.min((safePage + 1) * perPage, totalListings)} of {totalListings} listings
                </p>
              </>
            )}
          </div>
        </div>
      </div>

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

/* ── Market Card ── */

function MarketCard({
  listing,
  isOwner,
  onClick,
}: {
  listing: MockListing;
  isOwner: boolean;
  onClick: () => void;
}) {
  const { lobster } = listing;
  const isLegend = lobster.legend > 0;
  const classColor = CLASS_CARD_COLORS[lobster.class] ?? '#4682B4';

  if (listing.isEgg) {
    return (
      <div
        onClick={onClick}
        className="frosted-panel p-0 overflow-hidden rounded-xl cursor-pointer transition-all hover:border-[rgba(255,210,128,0.35)] card-hover group"
      >
        {/* Egg image area */}
        <div
          className="relative aspect-square flex items-center justify-center overflow-hidden p-4"
          style={{
            background: 'radial-gradient(ellipse at 50% 60%, rgba(205,112,0,0.35) 0%, rgba(205,112,0,0.10) 50%, transparent 80%)',
          }}
        >
          <Image
            src="/assets/characters/egg.png"
            alt="Egg"
            width={192}
            height={192}
            className="w-[65%] h-[65%] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] group-hover:scale-105 transition-transform duration-200"
            style={{ imageRendering: 'pixelated' }}
          />

          {/* Egg badge */}
          <div className="absolute top-2 left-2">
            <span className="text-xs font-bold px-2 py-1 rounded-md backdrop-blur-sm bg-amber-600/40 text-white flex items-center gap-1">
              <Egg className="size-3" /> Egg
            </span>
          </div>

          {/* Gen badge */}
          <div className="absolute top-2 right-2">
            <span className="text-xs px-2 py-1 rounded-md bg-ocean-deep/60 text-text-secondary backdrop-blur-sm">
              Gen {lobster.generation}
            </span>
          </div>
        </div>

        {/* Info area */}
        <div className="px-3 py-3.5 space-y-2">
          <div className="flex items-center gap-1">
            <span className="text-sm text-text-secondary">Class unknown until hatched</span>
            <span className="text-xs text-text-secondary ml-auto">#{listing.tokenId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-claw-gold font-mono">
              {Number(listing.price).toLocaleString()}
              <span className="text-xs text-claw-gold/70 ml-1">$CLAW</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        'frosted-panel p-0 overflow-hidden rounded-xl cursor-pointer transition-all hover:border-[rgba(255,210,128,0.35)] card-hover group',
        isLegend && 'ring-1 ring-claw-gold/30',
      )}
    >
      {/* Image area */}
      <div
        className="relative aspect-square flex items-center justify-center overflow-hidden p-4"
        style={{
          background: `radial-gradient(ellipse at 50% 60%, ${classColor}45 0%, ${classColor}15 50%, transparent 80%)`,
        }}
      >
        <Image
          src={listing.isEgg ? '/assets/characters/egg.png' : marketLobsterImage(listing.tokenId)}
          alt={lobster.className}
          width={192}
          height={192}
          className="w-[70%] h-[70%] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] group-hover:animate-idle-bob transition-transform duration-200"
          style={{ imageRendering: 'pixelated' }}
        />

        {/* Class badge — top left */}
        <div className="absolute top-2 left-2">
          <span
            className="text-xs font-bold px-2 py-1 rounded-md backdrop-blur-sm"
            style={{ backgroundColor: `${classColor}40`, color: 'white' }}
          >
            {lobster.className}
          </span>
        </div>

        {/* Tier + breed — top right */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <span className={cn('text-xs font-bold px-2 py-1 rounded-md', TIER_COLORS[lobster.evolutionTier])}>
            {tierLabel(lobster.evolutionTier)}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-ocean-deep/60 text-text-secondary backdrop-blur-sm">
            Breed {lobster.breedCount}/5
          </span>
        </div>

        {/* Legend sparkle */}
        {isLegend && (
          <div className="absolute bottom-2 left-2 bg-claw-gold/90 rounded-md px-2 py-0.5 flex items-center gap-1">
            <Sparkles className="size-3 text-white" />
            <span className="text-xs font-bold text-white">Legend</span>
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="px-3 py-3.5 space-y-2">
        {/* Purity stars */}
        <div className="flex items-center gap-1">
          <div className="flex gap-0.5">
            {Array.from({ length: 6 }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'text-sm leading-none',
                  i < lobster.purity ? 'text-claw-gold' : 'text-ocean-surface/50',
                )}
              >
                ★
              </span>
            ))}
          </div>
          <span className="text-xs text-text-secondary ml-auto">#{listing.tokenId}</span>
        </div>

        {/* Price */}
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-claw-gold font-mono">
            {Number(listing.price).toLocaleString()}
            <span className="text-xs text-claw-gold/70 ml-1">$CLAW</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Expanded Detail View ── */

const CARD_TABS = ['Info', 'Body Parts', 'DNA', 'History'] as const;
type CardTab = typeof CARD_TABS[number];

const TIER_PROGRESSION = ['Base', 'Evolved', 'Elite', 'Apex'] as const;

function ExpandedView({
  listing,
  isOwner,
  onClose,
  onAction,
}: {
  listing: MockListing;
  isOwner: boolean;
  onClose: () => void;
  onAction: () => void;
}) {
  const [tab, setTab] = useState<CardTab>('Info');
  const { lobster } = listing;
  const classColor = CLASS_CARD_COLORS[lobster.class] ?? '#4682B4';
  const isLegend = lobster.legend > 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-4 md:inset-y-8 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:max-w-4xl md:w-full z-50 overflow-y-auto scrollbar-hide">
        <FrostedPanel className="p-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
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

          <div className="md:flex">
            {/* Left: Character Spotlight */}
            <div className="md:w-[42%] p-6 flex flex-col items-center">
              <div
                className="relative w-full aspect-square max-w-[320px] rounded-xl flex items-center justify-center overflow-hidden mb-5"
                style={{
                  background: `radial-gradient(ellipse at 50% 60%, ${classColor}40 0%, ${classColor}15 50%, transparent 80%)`,
                }}
              >
                <Image
                  src={listing.isEgg ? '/assets/characters/egg.png' : marketLobsterImage(listing.tokenId)}
                  alt={lobster.className}
                  width={384}
                  height={384}
                  className="w-[85%] h-[85%] object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.5)] animate-idle-bob"
                  style={{ imageRendering: 'pixelated' }}
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

              {/* Buy / Delist */}
              <div className="w-full mt-6">
                <div className="frosted-panel-highlight p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-text-secondary">Price</span>
                    <span className="text-2xl font-bold text-claw-gold font-mono">
                      {Number(listing.price).toLocaleString()}
                      <span className="text-sm text-claw-gold/60 ml-1">$CLAW</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-secondary mb-3">
                    <span>Seller</span>
                    <span className="font-mono">{formatAddress(listing.seller)}</span>
                  </div>
                  {isOwner ? (
                    <TransactionButton
                      label="Delist"
                      variant="outline"
                      className="w-full"
                      fetchSteps={(auth) => api.market.delist(listing.listingId, auth)}
                      onSuccess={() => { onClose(); onAction(); }}
                    />
                  ) : (
                    <TransactionButton
                      label="Buy Now"
                      className="w-full"
                      fetchSteps={(auth) => api.market.buy(listing.listingId, auth)}
                      onSuccess={() => { onClose(); onAction(); }}
                    />
                  )}
                </div>
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
                      <p className="text-text-secondary text-center py-8">DNA data not available for eggs</p>
                    )}
                  </div>
                )}

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
        <button className="frosted-panel-highlight px-4 py-2 text-sm font-pixel text-claw-gold flex items-center gap-1.5 hover:border-[rgba(255,210,128,0.3)] transition-colors">
          <Store className="size-4" /> List Lobster
        </button>
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
              <Label htmlFor="price" className="text-text-secondary">Price ($CLAW)</Label>
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
