'use client';

import Link from 'next/link';
import { useActivityFeed } from '@/hooks/use-activity-feed';
import { formatAddress } from '@/lib/format';
import type { ActivityEvent } from '@/lib/api';
import { Activity } from 'lucide-react';
import { PixelIcon } from '@/components/ui/pixel-icon';
import { EVENT_ICONS, ICONS } from '@/lib/assets';

/** Compact, auto-scrolling activity ticker for the landing page. */
export function ActivityTicker() {
  const { events, loading } = useActivityFeed({
    limit: 10,
    pollInterval: 20_000,
    enableWs: true,
  });

  if (loading) {
    return (
      <div className="border border-border rounded-md p-4 text-center">
        <p className="text-xs text-muted-foreground animate-pulse">Loading live activity...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="border border-border rounded-md p-4 text-center">
        <p className="text-xs text-muted-foreground">No activity yet. Be the first!</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/50">
        <div className="flex items-center gap-1.5">
          <Activity className="size-3.5 text-teal" />
          <span className="text-xs font-medium text-muted-foreground">Live Activity</span>
        </div>
        <Link href="/activity" className="text-xs text-ocean hover:underline">
          View all
        </Link>
      </div>
      <div className="divide-y divide-border">
        {events.slice(0, 8).map((event) => (
          <ActivityRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const { iconSrc, label, detail } = describeEvent(event);
  const age = formatAge(event.timestamp);

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <PixelIcon src={iconSrc} alt={label} size={16} className="shrink-0" />
      <span className="text-muted-foreground truncate flex-1">
        <span className="text-foreground font-medium">{label}</span>{' '}
        {detail}
      </span>
      <span className="text-muted-foreground shrink-0">{age}</span>
    </div>
  );
}

function describeEvent(event: ActivityEvent): { iconSrc: string; label: string; detail: string } {
  const d = event.data ?? {};
  const iconSrc = EVENT_ICONS[event.type] ?? ICONS.event;

  switch (event.type) {
    case 'battle_settled': {
      const winner = d.winner as string | undefined;
      return {
        iconSrc,
        label: 'Battle settled',
        detail: winner ? `winner ${formatAddress(winner)}` : '',
      };
    }
    case 'lobster_bred': {
      const breeder = (d.owner ?? d.breeder) as string | undefined;
      return {
        iconSrc,
        label: 'Lobster bred',
        detail: breeder ? `by ${formatAddress(breeder)}` : '',
      };
    }
    case 'lobster_evolved': {
      const owner = d.owner as string | undefined;
      return {
        iconSrc,
        label: 'Lobster evolved',
        detail: owner ? `by ${formatAddress(owner)}` : '',
      };
    }
    case 'listing_sold': {
      const price = d.price as string | undefined;
      const buyer = d.buyer as string | undefined;
      return {
        iconSrc,
        label: 'Sold',
        detail: buyer ? `to ${formatAddress(buyer)}${price ? ` for ${Number(price).toLocaleString()} $CLAW` : ''}` : '',
      };
    }
    case 'expedition_claimed': {
      const owner = d.owner as string | undefined;
      const reward = d.reward as string | undefined;
      return {
        iconSrc,
        label: 'Mining claimed',
        detail: owner
          ? `${formatAddress(owner)}${reward ? ` +${Number(reward).toLocaleString()} $CLAW` : ''}`
          : '',
      };
    }
    case 'lobster_minted': {
      const to = (d.to ?? d.owner) as string | undefined;
      return {
        iconSrc,
        label: 'Lobster minted',
        detail: to ? `to ${formatAddress(to)}` : '',
      };
    }
    case 'listing_created': {
      const seller = d.seller as string | undefined;
      const price = d.price as string | undefined;
      return {
        iconSrc,
        label: 'Listed',
        detail: seller
          ? `by ${formatAddress(seller)}${price ? ` for ${Number(price).toLocaleString()} $CLAW` : ''}`
          : '',
      };
    }
    default:
      return {
        iconSrc,
        label: event.type.replace(/_/g, ' '),
        detail: '',
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
