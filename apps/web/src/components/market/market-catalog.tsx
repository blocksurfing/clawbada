'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ListingData, type MarketFilters } from '@/lib/api';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { tierLabel } from '@/lib/format';
import { PixelPanel } from '@/components/shell/pixel-panel';
import { PixelSprite } from '@/components/pixel/pixel-sprite';
import { AnimatedLobster } from '@/components/game/animated-lobster';
import { MarketArtButton, MarketTxButton } from './market-art-button';
import './market.css';

/**
 * Nzib's Marketplace catalogue (`pages/market.html` + `components/market.js`, drop ee1219f) on the real
 * listings: the wooden filter panel drives the listings query, the grid pages by the API's offset eight at a
 * time, and every card is one of his 444 px nine-slice cards. Owner decisions (2026-10-16): each card shows the
 * lobster's own sprite (his tier frame until the genes arrive), the Bid slot carries Details, the demo rarity
 * select is a Legend toggle, and eggs are dormant until an egg asset exists in the game.
 */
export const MARKET_PAGE_SIZE = 8;

/** His dark swatches sampled from Avatar_BG.png, in class order (Bulwark … Ember). */
const CLASS_BACKGROUNDS = ['#202644', '#00283a', '#000065', '#302922', '#200b64', '#416e82', '#5f020f', '#0e1b2c', '#002e32', '#1d1922'] as const;
const TIER_SHEETS = ['marketBase', 'marketEvolved', 'marketElite', 'marketApex'] as const;
const TIER_NAMES = ['Base', 'Evolved', 'Elite', 'Apex'] as const;
/** Tileset symbol frames: purity star 32, breed 33, egg 34, tiers 35–38. */
const FRAME_PURITY = 32, FRAME_BREED = 33, FRAME_EGG = 34, FRAME_TIER0 = 35;

export interface CatalogFilters {
  type: 'all' | 'lobster' | 'egg';
  sort: 'recent' | 'price_asc' | 'price_desc';
  klass: number | null;
  tier: number | null;
  purity: number | null;
  minPrice: string;
  maxPrice: string;
  legend: boolean;
}

export const DEFAULT_FILTERS: CatalogFilters = { type: 'all', sort: 'recent', klass: null, tier: null, purity: null, minPrice: '', maxPrice: '', legend: false };

/** The listings query for a filter set and a page: nine rows so the ninth tells us whether Next has anything. */
export function toListingsQuery(f: CatalogFilters, page: number): MarketFilters {
  const q: MarketFilters = { sort: f.sort, limit: MARKET_PAGE_SIZE + 1, offset: page * MARKET_PAGE_SIZE };
  if (f.klass != null) q.class = f.klass;
  if (f.tier != null) q.tier = f.tier;
  if (f.purity != null) q.minPurity = f.purity;
  if (f.minPrice !== '' && Number(f.minPrice) >= 0) q.minPrice = Math.floor(Number(f.minPrice));
  if (f.maxPrice !== '' && Number(f.maxPrice) >= 0) q.maxPrice = Math.floor(Number(f.maxPrice));
  if (f.legend) q.legend = true;
  return q;
}

interface MarketCatalogProps {
  address?: string;
  onOpen: (listing: ListingData) => void;
  onChanged: () => void;
  /** The selling entry point (the List dialog's trigger), shown above the grid. */
  listAction?: ReactNode;
}

export function MarketCatalog({ address, onOpen, onChanged, listAction }: MarketCatalogProps) {
  const [filters, setFilters] = useState<CatalogFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const eggsOnly = filters.type === 'egg';

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['listings', filters, page],
    queryFn: () => api.market.listings(toListingsQuery(filters, page)),
    enabled: !eggsOnly,
    refetchInterval: 30_000,
  });
  // No egg asset exists yet: the Eggs view is the dormant empty state, lobster rows never carry type 'egg'.
  const rows = eggsOnly ? [] : (data?.listings ?? []).filter((l) => filters.type !== 'lobster' || l.type !== 'egg');
  const shown = rows.slice(0, MARKET_PAGE_SIZE);
  const hasNext = rows.length > MARKET_PAGE_SIZE;

  const set = (patch: Partial<CatalogFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };
  const reset = () => { setFilters(DEFAULT_FILTERS); setPage(0); };
  const me = address?.toLowerCase();

  return (
    <PixelPanel as="div" className="market-layout market-catalog" aria-label="Marketplace catalogue">
      <PixelPanel as="form" className="market-filters" aria-labelledby="market-filter-title" onSubmit={(e) => e.preventDefault()} onReset={(e) => { e.preventDefault(); reset(); }}>
        <h2 id="market-filter-title">Filters</h2>
        <label>Type
          <select name="type" aria-label="Type" value={filters.type} onChange={(e) => set({ type: e.target.value as CatalogFilters['type'] })}>
            <option value="all">All</option>
            <option value="lobster">Lobsters</option>
            <option value="egg">Eggs</option>
          </select>
        </label>
        <label>Sort
          <select name="sort" aria-label="Sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as CatalogFilters['sort'] })}>
            <option value="recent">Most recent</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
        </label>
        <fieldset className="market-class-filter">
          <legend>Class</legend>
          <label className="market-class-choice">
            <input type="radio" name="klass" value="" checked={filters.klass === null} onChange={() => set({ klass: null })} />
            <span>All classes</span>
          </label>
          {CLASS_NAMES_LIST.map((name, i) => (
            <label key={name} className="market-class-choice">
              <input type="radio" name="klass" value={i} checked={filters.klass === i} onChange={() => set({ klass: i })} />
              <PixelSprite asset="classBadges" frame={i} />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
        <label>Tier
          <select name="tier" aria-label="Tier" value={filters.tier ?? ''} onChange={(e) => set({ tier: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">All tiers</option>
            {TIER_NAMES.map((t, i) => <option key={t} value={i}>{t}</option>)}
          </select>
        </label>
        <label>Min purity
          <select name="purity" aria-label="Min purity" value={filters.purity ?? ''} onChange={(e) => set({ purity: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Any</option>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ★+</option>)}
            <option value={6}>6 ★</option>
          </select>
        </label>
        <label>Min price (GOLD)
          <input name="minPrice" type="number" min={0} step={1} placeholder="0" value={filters.minPrice} onChange={(e) => set({ minPrice: e.target.value })} />
        </label>
        <label>Max price (GOLD)
          <input name="maxPrice" type="number" min={0} step={1} placeholder="No limit" value={filters.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} />
        </label>
        <label className="market-legend-choice">
          <input type="checkbox" name="legend" checked={filters.legend} onChange={(e) => set({ legend: e.target.checked })} />
          <span>Legends only</span>
        </label>
        <button className="pixel-button" type="reset">Reset filters</button>
      </PixelPanel>

      <div className="market-results" aria-label="Listings">
        <div className="market-toolbar">
          <p aria-live="polite">
            {eggsOnly ? 'Eggs' : isLoading ? 'Loading listings…' : isError ? 'Could not load listings.' : shown.length === 0 ? 'Nothing listed for these filters.' : `${shown.length}${hasNext ? '+' : ''} listing${shown.length !== 1 || hasNext ? 's' : ''}${page > 0 ? ` · page ${page + 1}` : ''}${isFetching ? ' · refreshing' : ''}`}
          </p>
          {listAction}
        </div>

        {isError ? (
          <p className="market-empty">Could not load listings. <button type="button" className="pixel-button" onClick={() => void refetch()}>Retry</button></p>
        ) : (
          <div className="market-grid pixel-grid" data-pixel-grid data-columns="4" data-min-width="270">
            {shown.map((l) => <MarketCard key={l.listingId} listing={l} mine={!!me && l.seller.toLowerCase() === me} onOpen={onOpen} onChanged={onChanged} />)}
          </div>
        )}

        {!isError && !isLoading && shown.length === 0 && (
          <p className="market-empty" data-market-empty>
            {eggsOnly
              ? 'No eggs listed yet. Eggs arrive with the breeding update; the Market will list them here.'
              : page > 0
                ? 'No more listings.'
                : filters === DEFAULT_FILTERS
                  ? 'Nothing listed yet. Be the first to list a lobster.'
                  : 'No listings match. Change or reset the filters.'}
          </p>
        )}

        <nav className="market-pagination" aria-label="Listing pages">
          <button className="pixel-button" type="button" data-market-prev disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
          <p data-market-page>Page {page + 1}</p>
          <button className="pixel-button" type="button" data-market-next disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>Next</button>
        </nav>
      </div>
    </PixelPanel>
  );
}

function MarketCard({ listing, mine, onOpen, onChanged }: { listing: ListingData; mine: boolean; onOpen: (l: ListingData) => void; onChanged: () => void }) {
  const isEgg = listing.type === 'egg';
  const klass = listing.class ?? 0;
  const tier = listing.evolutionTier ?? 0;
  const className = CLASS_NAMES_LIST[klass] ?? 'Unknown';
  const tierName = tierLabel(tier);
  const purity = listing.purity ?? 0;
  const breedCount = listing.breedCount ?? 0;
  const hasDna = !!listing.dna && listing.dna !== '0';
  // Nzib's class-and-tier frame: the art until the lobster's own sprite is ready, and the art when it never is.
  const tierFrame = <PixelSprite asset={TIER_SHEETS[tier] ?? 'marketBase'} frame={klass} role="img" aria-label={`${className} ${tierName}`} />;
  const bg = isEgg ? '#2e222f' : CLASS_BACKGROUNDS[klass] ?? '#2e222f';
  const titleId = `market-${listing.listingId}`;
  const open = () => onOpen(listing);

  return (
    <PixelPanel
      as="article"
      asset="marketCard"
      className="market-card"
      data-listing-id={listing.listingId}
      style={{ '--market-card-bg': bg } as CSSProperties}
      aria-labelledby={titleId}
      onClick={open}
    >
      <span className="market-id">#{listing.tokenId}</span>
      <header className="market-card-header">
        <div className="market-card-identity">
          <h3 id={titleId}>
            <span className="market-tier-symbol" tabIndex={0} role="img" aria-label={isEgg ? 'Egg' : tierName}>
              <PixelSprite asset="marketPurity" frame={isEgg ? FRAME_EGG : FRAME_TIER0 + tier} />
              <span className="market-symbol-label" aria-hidden="true">{isEgg ? 'Egg' : tierName}</span>
              <span className="market-class-tooltip" aria-hidden="true">{isEgg ? 'Egg' : tierName}</span>
            </span>
          </h3>
          {!isEgg && (
            <span className="market-class-badge" tabIndex={0} role="img" aria-label={className}>
              <PixelSprite asset="classBadges" frame={klass} />
              <span className="market-symbol-label" aria-hidden="true">{className}</span>
              <span className="market-class-tooltip" aria-hidden="true">{className}</span>
            </span>
          )}
        </div>
        {!isEgg && (
          <div className="market-card-right">
            <dl className="market-details">
              <div className="market-purity">
                <dt className="market-purity-label">Purity</dt>
                <dd>
                  <span className="market-purity-stars" role="img" aria-label={`${purity} of 6 purity`} tabIndex={0} data-header-tooltip={`Purity: ${purity}/6`}>
                    <PixelSprite asset="marketPurity" frame={FRAME_PURITY} /> <span>{purity}</span>
                  </span>
                </dd>
              </div>
              <div className="market-breed" tabIndex={0} aria-label={`Breed count: ${breedCount}`} data-header-tooltip={`Breed count: ${breedCount}`}>
                <dt><span className="market-purity-label">Breed</span><PixelSprite asset="marketBreed" frame={FRAME_BREED} /></dt>
                <dd>{breedCount}</dd>
              </div>
            </dl>
          </div>
        )}
      </header>
      {isEgg ? (
        <div className="market-egg-art"><span className="market-egg-sprite" role="img" tabIndex={0} title="Class unknown until hatched" aria-label="Egg — class unknown until hatched" /></div>
      ) : (
        <div className="market-lobster-art">
          {hasDna
            ? <AnimatedLobster dna={listing.dna!} evolutionTier={tier} displaySize={192} frameSize={80} frames={16} fallback={tierFrame} />
            : tierFrame}
        </div>
      )}
      <PixelPanel as="div" asset="marketDivider" className="market-card-divider" aria-hidden="true" />
      <footer className="market-card-footer">
        <div className="market-card-actions">
          <MarketTxButton listingId={listing.listingId} tokenId={listing.tokenId} price={listing.price} mode={mine ? 'delist' : 'buy'} onDone={onChanged} />
          <MarketArtButton asset="marketBidButton" className="market-details-button" aria-label={`Details of #${listing.tokenId}`} onClick={(e) => { e.stopPropagation(); open(); }}>Details</MarketArtButton>
        </div>
      </footer>
    </PixelPanel>
  );
}
