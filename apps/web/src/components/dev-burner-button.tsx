'use client';

/**
 * Dev-only: connect the burner wallet (see lib/burner-connector.ts). Renders nothing
 * unless the `burner` connector is registered (NEXT_PUBLIC_DEV_BURNER=true).
 */
import { useAccount, useConnect, useDisconnect } from 'wagmi';

export function DevBurnerButton() {
  const { connectors, connect, isPending } = useConnect();
  const { isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const burner = connectors.find((c) => c.id === 'burner');
  if (!burner) return null;
  if (isConnected && connector?.id === 'burner') {
    return (
      <button
        type="button"
        className="text-[10px] font-pixel px-2 py-1 rounded border border-claw-gold/50 text-claw-gold"
        onClick={() => disconnect()}
        title="Disconnect the dev burner wallet"
      >
        burner ✓
      </button>
    );
  }
  if (isConnected) return null;
  return (
    <button
      type="button"
      className="text-[10px] font-pixel px-2 py-1 rounded border border-border text-text-secondary hover:text-foreground"
      onClick={() => connect({ connector: burner })}
      disabled={isPending}
      title="Dev only: connect a local burner wallet (no extension needed)"
    >
      burner wallet
    </button>
  );
}
