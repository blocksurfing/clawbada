'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, type MarketFilters, type LobsterData } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LobsterCard } from '@/components/game/lobster-card';
import { TransactionButton } from '@/components/game/transaction-button';
import { formatClaw, formatAddress, tierLabel } from '@/lib/format';
import { Store } from 'lucide-react';

const CLASS_NAMES = [
  'Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter',
  'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember',
] as const;

export default function MarketplacePage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

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

  const listings = listingsData?.listings ?? [];
  const unlockedLobsters = lobstersData?.lobsters.filter((l) => !l.locked && !l.soulbound) ?? [];

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-1">Buy and sell lobsters</p>
        </div>
        {address && (
          <ListLobsterDialog lobsters={unlockedLobsters} onSuccess={invalidate} />
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={filters.class != null ? String(filters.class) : 'all'}
          onValueChange={(v) => setFilters((f) => ({ ...f, class: v === 'all' ? undefined : Number(v) }))}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {CLASS_NAMES.map((name, i) => (
              <SelectItem key={i} value={String(i)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.tier != null ? String(filters.tier) : 'all'}
          onValueChange={(v) => setFilters((f) => ({ ...f, tier: v === 'all' ? undefined : Number(v) }))}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            {[0, 1, 2, 3].map((t) => (
              <SelectItem key={t} value={String(t)}>{tierLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.sort ?? 'recent'}
          onValueChange={(v) => setFilters((f) => ({ ...f, sort: v as MarketFilters['sort'] }))}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most Recent</SelectItem>
            <SelectItem value="price_asc">Price: Low</SelectItem>
            <SelectItem value="price_desc">Price: High</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.legend != null ? String(filters.legend) : 'all'}
          onValueChange={(v) => setFilters((f) => ({ ...f, legend: v === 'all' ? undefined : v === 'true' }))}
        >
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Legend" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Legends</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Listings grid */}
      {listings.length === 0 ? (
        <div className="border border-border rounded-md p-12 text-center">
          <p className="text-sm text-muted-foreground">No listings found matching your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {listings.map((listing) => (
            <div key={listing.listingId} className="space-y-2">
              <Link href={`/lobster/${listing.tokenId}`}>
                <div className="border border-border rounded-md p-2.5 card-hover hover:border-muted-foreground/30 cursor-pointer">
                  <div className="text-xs font-medium truncate">#{listing.tokenId}</div>
                  {listing.class != null && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 mt-1">
                      {CLASS_NAMES[listing.class]}
                    </Badge>
                  )}
                  <div className="text-sm font-semibold font-mono mt-1 text-claw-gold">{formatClaw(listing.price)}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{formatAddress(listing.seller)}</div>
                </div>
              </Link>
              {address && listing.seller.toLowerCase() === address.toLowerCase() ? (
                <TransactionButton
                  label="Delist"
                  variant="outline"
                  size="sm"
                  fetchSteps={(auth) => api.market.delist(listing.listingId, auth)}
                  onSuccess={invalidate}
                />
              ) : address ? (
                <TransactionButton
                  label="Buy"
                  size="sm"
                  fetchSteps={(auth) => api.market.buy(listing.listingId, auth)}
                  onSuccess={invalidate}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Showing {listings.length} of {listingsData?.count ?? 0} listings
      </p>
    </div>
  );
}

function ListLobsterDialog({ lobsters, onSuccess }: { lobsters: LobsterData[]; onSuccess: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setSelected(null); setPrice(''); } }}>
      <DialogTrigger asChild>
        <Button size="sm">List Lobster</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>List a Lobster for Sale</DialogTitle>
        </DialogHeader>
        {!selected ? (
          <>
            <p className="text-sm text-muted-foreground mb-4">Select a lobster to list:</p>
            {lobsters.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No eligible lobsters to list.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {lobsters.map((lob) => (
                  <LobsterCard
                    key={lob.tokenId}
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
                    onClick={() => setSelected(lob.tokenId)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Back</Button>
              <span className="text-sm">Listing Lobster #{selected}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price ($CLAW)</Label>
              <Input
                id="price"
                type="number"
                placeholder="e.g. 5000"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
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
