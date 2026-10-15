import type { Metadata } from 'next';
import { Black_Han_Sans, Titillium_Web } from 'next/font/google';
import localFont from 'next/font/local';
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

/** Nzib's menu/UI face for the pixel chrome (freeware by Brian Kent; the licence text sits beside the file). */
const upheaval = localFont({
  src: '../fonts/upheaval/upheavtt.ttf',
  weight: '400',
  variable: '--font-upheaval',
  display: 'swap',
});

/** Nzib's body face for the Shell's copy (DaFont lists it 100% free; its README sits beside the file). */
const rainyHearts = localFont({
  src: '../fonts/rainyhearts/rainyhearts.ttf',
  weight: '400',
  variable: '--font-rainy',
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
      <body className={`${blackHanSans.variable} ${titillium.variable} ${upheaval.variable} ${rainyHearts.variable}`}>
        <Web3Provider>
          <CursorPressTracker />
          {children}
          <MusicToggle />
        </Web3Provider>
      </body>
    </html>
  );
}
