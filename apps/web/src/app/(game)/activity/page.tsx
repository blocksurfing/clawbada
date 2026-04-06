'use client';

import { useActivityFeed } from '@/hooks/use-activity-feed';
import { Badge } from '@/components/ui/badge';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { PixelIcon } from '@/components/ui/pixel-icon';
import { EVENT_ICONS, ICONS } from '@/lib/assets';
import { formatAddress } from '@/lib/format';
import type { ActivityEvent } from '@/lib/api';
import { Activity, Loader2 } from 'lucide-react';
import { useState } from 'react';

const FILTER_TABS = [
  { value: undefined, label: 'All' },
  { value: 'battle_settled', label: 'Battles' },
  { value: 'lobster_bred', label: 'Breeds' },
  { value: 'listing_sold', label: 'Sales' },
  { value: 'listing_created', label: 'Listings' },
  { value: 'expedition_claimed', label: 'Mining' },
  { value: 'lobster_evolved', label: 'Evolution' },
] as const;

export default function ActivityPage() {
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);

  const { events, loading, error, hasMore, loadMore, loadingMore } = useActivityFeed({
    limit: 30,
    type: typeFilter,
    pollInterval: 15_000,
    enableWs: true,
  });

  return (
    <PageBackground variant="reef">
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-teal" />
            <h1 className="font-pixel text-xl text-foreground">Activity</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Live on-chain events from the Clawbada economy
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.label}
              onClick={() => setTypeFilter(tab.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                typeFilter === tab.value
                  ? 'bg-teal/20 text-teal'
                  : 'text-text-secondary hover:text-foreground hover:bg-ocean-surface/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error state */}
        {error && (
          <FrostedPanel variant="danger" className="text-center">
            <p className="text-sm text-destructive">{error}</p>
          </FrostedPanel>
        )}

        {/* Loading state */}
        {loading && (
          <FrostedPanel className="py-12 text-center">
            <Loader2 className="size-5 mx-auto animate-spin text-text-secondary" />
            <p className="text-sm text-text-secondary mt-2">Loading activity...</p>
          </FrostedPanel>
        )}

        {/* Empty state */}
        {!loading && events.length === 0 && (
          <FrostedPanel className="py-12 text-center">
            <Activity className="size-6 mx-auto mb-3 text-text-secondary" />
            <p className="text-sm text-text-secondary">
              {typeFilter ? 'No events of this type yet.' : 'No activity yet. The economy is waiting for its first movers.'}
            </p>
          </FrostedPanel>
        )}

        {/* Event list */}
        {!loading && events.length > 0 && (
          <div className="space-y-1.5">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="pt-4 text-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="frosted-panel px-4 py-2 text-xs text-text-secondary hover:text-foreground hover:border-[rgba(255,210,128,0.3)] transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" /> Loading...
                    </span>
                  ) : (
                    'Load older events'
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </PageBackground>
  );
}

function EventCard({ event }: { event: ActivityEvent }) {
  const { iconSrc, typeBadge, color, description, meta } = describeEvent(event);
  const age = formatAge(event.timestamp);

  return (
    <FrostedPanel className="flex items-start gap-3 px-4 py-3">
      <PixelIcon src={iconSrc} alt={typeBadge} size={24} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge className={`${color} border-0 font-pixel text-[9px] px-1.5`}>
            {typeBadge}
          </Badge>
          <span className="text-[10px] text-text-secondary">{age}</span>
        </div>
        <p className="text-sm text-foreground mt-1">{description}</p>
        {meta && <p className="text-xs text-text-secondary mt-0.5">{meta}</p>}
      </div>
      {event.txHash && (
        <a
          href={`https://basescan.org/tx/${event.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-text-secondary hover:text-ocean font-mono shrink-0 mt-1"
        >
          tx
        </a>
      )}
    </FrostedPanel>
  );
}

function describeEvent(event: ActivityEvent): {
  iconSrc: string;
  typeBadge: string;
  color: string;
  description: string;
  meta: string | null;
} {
  const d = event.data ?? {};
  const iconSrc = EVENT_ICONS[event.type] ?? ICONS.event;

  switch (event.type) {
    case 'battle_settled': {
      const winner = d.winner as string | undefined;
      const loser = d.loser as string | undefined;
      const payout = d.winnerPayout as string | undefined;
      return {
        iconSrc,
        typeBadge: 'Battle',
        color: 'bg-coral/15 text-coral',
        description: winner && loser
          ? `${formatAddress(winner)} defeated ${formatAddress(loser)}`
          : 'Battle resolved',
        meta: payout ? `Payout: ${Number(payout).toLocaleString()} $CLAW` : null,
      };
    }
    case 'lobster_bred': {
      const breeder = (d.owner ?? d.breeder) as string | undefined;
      const offspringId = d.offspringId as string | undefined;
      return {
        iconSrc,
        typeBadge: 'Breed',
        color: 'bg-teal/15 text-teal',
        description: breeder
          ? `${formatAddress(breeder)} bred a new lobster${offspringId ? ` #${offspringId}` : ''}`
          : 'New lobster bred',
        meta: null,
      };
    }
    case 'lobster_evolved': {
      const owner = d.owner as string | undefined;
      const newTier = d.newTier as number | undefined;
      const tierNames = ['Base', 'Evolved', 'Elite', 'Apex'];
      return {
        iconSrc,
        typeBadge: 'Evolution',
        color: 'bg-claw-gold/15 text-claw-gold',
        description: owner
          ? `${formatAddress(owner)} evolved a lobster${newTier != null ? ` to ${tierNames[newTier] ?? `Tier ${newTier}`}` : ''}`
          : 'Lobster evolved',
        meta: null,
      };
    }
    case 'listing_sold': {
      const seller = d.seller as string | undefined;
      const buyer = d.buyer as string | undefined;
      const price = d.price as string | undefined;
      const tokenId = d.tokenId as string | undefined;
      return {
        iconSrc,
        typeBadge: 'Sale',
        color: 'bg-ocean/15 text-ocean',
        description: buyer && seller
          ? `${formatAddress(buyer)} bought lobster${tokenId ? ` #${tokenId}` : ''} from ${formatAddress(seller)}`
          : 'Lobster sold on marketplace',
        meta: price ? `Price: ${Number(price).toLocaleString()} $CLAW` : null,
      };
    }
    case 'listing_created': {
      const seller = d.seller as string | undefined;
      const price = d.price as string | undefined;
      const tokenId = d.tokenId as string | undefined;
      return {
        iconSrc,
        typeBadge: 'Listing',
        color: 'bg-ocean/15 text-ocean',
        description: seller
          ? `${formatAddress(seller)} listed lobster${tokenId ? ` #${tokenId}` : ''}`
          : 'New marketplace listing',
        meta: price ? `Price: ${Number(price).toLocaleString()} $CLAW` : null,
      };
    }
    case 'expedition_claimed': {
      const owner = d.owner as string | undefined;
      const reward = d.reward as string | undefined;
      return {
        iconSrc,
        typeBadge: 'Mining',
        color: 'bg-text-accent/15 text-text-accent',
        description: owner
          ? `${formatAddress(owner)} claimed a mining expedition`
          : 'Mining expedition claimed',
        meta: reward ? `Reward: ${Number(reward).toLocaleString()} $CLAW` : null,
      };
    }
    case 'lobster_minted': {
      const to = (d.to ?? d.owner) as string | undefined;
      const tokenId = d.tokenId as string | undefined;
      return {
        iconSrc,
        typeBadge: 'Mint',
        color: 'bg-teal/15 text-teal',
        description: to
          ? `Lobster${tokenId ? ` #${tokenId}` : ''} minted to ${formatAddress(to)}`
          : 'New lobster minted',
        meta: null,
      };
    }
    default:
      return {
        iconSrc,
        typeBadge: event.type.replace(/_/g, ' '),
        color: 'bg-ocean-surface/50 text-text-secondary',
        description: `${event.type} event`,
        meta: null,
      };
  }
}

function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
