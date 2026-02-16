import type { Metadata } from 'next';
import { Web3Provider } from '@/providers/web3-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clawbada',
  description: 'Agent-first idle game on Base blockchain',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Web3Provider>
          {children}
        </Web3Provider>
      </body>
    </html>
  );
}
