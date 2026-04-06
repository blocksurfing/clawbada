import type { Metadata } from 'next';
import { Silkscreen } from 'next/font/google';
import { Web3Provider } from '@/providers/web3-provider';
import { MusicToggle } from '@/components/music-toggle';
import './globals.css';

const silkscreen = Silkscreen({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-silkscreen',
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
      <body className={silkscreen.variable}>
        <Web3Provider>
          {children}
          <MusicToggle />
        </Web3Provider>
      </body>
    </html>
  );
}
