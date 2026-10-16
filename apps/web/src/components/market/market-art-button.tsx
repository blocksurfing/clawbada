'use client';

import { useCallback, useRef, type ButtonHTMLAttributes } from 'react';
import { useConnect } from 'wagmi';
import { useAuth } from '@/hooks/use-auth';
import { useCalldataTx } from '@/hooks/use-calldata-tx';
import { api } from '@/lib/api';
import { usePixelPanel } from '@/components/shell/pixel-panel';
import { PIXEL_ASSETS, type PanelAssetName } from '@/components/pixel/pixel-assets';
import { PixelSprite } from '@/components/pixel/pixel-sprite';

interface MarketArtButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The horizontal button strip to paint behind the label (Nzib's price label or bid art). */
  asset: PanelAssetName;
}

/** A button drawn with one of Nzib's art strips: the nine-slice canvas sits behind the content. */
export function MarketArtButton({ asset, className, children, ...rest }: MarketArtButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  usePixelPanel(ref, canvasRef, PIXEL_ASSETS[asset]);
  return (
    <button ref={ref} type="button" className={`pixel-button pixel-panel${className ? ` ${className}` : ''}`} data-pixel-panel={asset} {...rest}>
      <canvas ref={canvasRef} aria-hidden="true" className="pixel-panel-art" />
      {children}
    </button>
  );
}

interface MarketTxButtonProps {
  listingId: string;
  tokenId: string;
  /** Whole $GOLD, as the indexer stores it. */
  price: string;
  mode: 'buy' | 'delist';
  onDone: () => void;
}

/**
 * Nzib's Buy button (price label art + the $GOLD coin + the amount) wired to the real market: the same
 * state machine as `TransactionButton` (sign in → steps from the API → each step in the wallet), kept short
 * because the art is 48 px tall. A disconnected visitor gets the wallet picker instead. On the seller's own
 * listing the button delists.
 */
export function MarketTxButton({ listingId, tokenId, price, mode, onDone }: MarketTxButtonProps) {
  const { getAuthHeaders, isConnected } = useAuth();
  const { connect, connectors } = useConnect();
  const { execute, status, error, reset, currentStep } = useCalldataTx();
  const priceText = Number(price).toLocaleString('en-US');

  // Disconnected: hand over to the chrome's Connect button (the wallet picker lives there, so this page
  // does not bundle the picker itself); below the large breakpoint there is no plank, so connect directly.
  const openWalletPicker = useCallback(() => {
    const plank = document.querySelector<HTMLButtonElement>('.connect-wallet');
    if (plank) { plank.click(); return; }
    const connector = connectors[0];
    if (connector) connect({ connector });
  }, [connect, connectors]);

  const run = useCallback(async () => {
    if (!isConnected) { openWalletPicker(); return; }
    if (status === 'success' || status === 'error') { reset(); return; }
    try {
      const auth = await getAuthHeaders();
      const { steps } = mode === 'buy' ? await api.market.buy(listingId, auth) : await api.market.delist(listingId, auth);
      await execute(steps);
      onDone();
    } catch {
      // the status carries the failure; the title shows the reason
    }
  }, [isConnected, openWalletPicker, status, reset, getAuthHeaders, mode, listingId, execute, onDone]);

  const busy = status === 'pending' || status === 'confirming';
  const text = status === 'pending' ? `Sign ${currentStep + 1}`
    : status === 'confirming' ? 'Confirming'
    : status === 'success' ? 'Done'
    : status === 'error' ? 'Retry'
    : mode === 'buy' ? priceText : 'Delist';
  const label = mode === 'buy'
    ? (isConnected ? `Buy #${tokenId} for ${priceText} GOLD` : `Connect a wallet to buy #${tokenId} for ${priceText} GOLD`)
    : `Delist #${tokenId}`;

  return (
    <MarketArtButton
      asset="marketPriceLabel"
      className="market-buy"
      aria-label={label}
      title={status === 'error' && error ? error : label}
      data-tx={status}
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); void run(); }}
    >
      {status === 'idle' && mode === 'buy' && <PixelSprite asset="menuIcons" frame={8} />}
      <span className="market-buy-price">{text}</span>
    </MarketArtButton>
  );
}
