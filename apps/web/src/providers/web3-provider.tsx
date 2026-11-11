'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { WagmiProvider, useAccount, useAccountEffect } from 'wagmi';
import { ConnectKitProvider } from 'connectkit';
import { config } from '@/lib/wagmi';
import { forgetWalletSession } from '@/hooks/use-auth';

/**
 * A wallet that disconnects leaves no session behind — whichever control disconnected it: the wallet panel,
 * ConnectKit's own modal (the only one on phones), or the wallet itself. Before this only the wallet panel cleared
 * the stored session, so on a shared device it stayed usable for up to a day.
 */
function ForgetSessionOnDisconnect() {
  const { address } = useAccount();
  const last = useRef<string | undefined>(address);
  useEffect(() => { if (address) last.current = address; }, [address]);
  useAccountEffect({
    onDisconnect() {
      if (last.current) forgetWalletSession(last.current);
      last.current = undefined;
    },
  });
  return null;
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ForgetSessionOnDisconnect />
        <ConnectKitProvider>
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
