import type { Metadata } from 'next';
import { Black_Han_Sans, Titillium_Web } from 'next/font/google';
import { Web3Provider } from '@/providers/web3-provider';
import { MusicToggle } from '@/components/music-toggle';
import { CursorPressTracker } from '@/components/cursor-press-tracker';
import './globals.css';

const blackHanSans = Black_Han_Sans({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

const titillium = Titillium_Web({
  weight: ['300', '400', '600', '700', '900'],
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Clawbada',
  description: 'Agent-first idle game on Base blockchain',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Figma capture script — remove after design handoff */}
        <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async />
      </head>
      <body className={`${blackHanSans.variable} ${titillium.variable}`}>
        <Web3Provider>
          <CursorPressTracker />
          {children}
          <MusicToggle />
        </Web3Provider>
      </body>
    </html>
  );
}
