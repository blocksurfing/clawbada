import type { Metadata } from 'next';
import { Black_Han_Sans, Titillium_Web } from 'next/font/google';
import localFont from 'next/font/local';
import { Web3Provider } from '@/providers/web3-provider';
import { MusicToggle } from '@/components/music-toggle';
import { CursorPressTracker } from '@/components/cursor-press-tracker';
import { BattleEntryOverlay } from '@/components/battle/battle-entry-overlay';
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

/** Nzib's body face (his shared typography, design/website ee1219f): Big Shot regular at natural scale, no
 *  synthetic bold. Replaces Rainy Hearts. The README beside the file records its source. */
const bigShot = localFont({
  src: '../fonts/big-shot/big-shot.ttf',
  weight: '400',
  variable: '--font-bigshot',
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
      <body className={`${blackHanSans.variable} ${titillium.variable} ${upheaval.variable} ${bigShot.variable}`}>
        <Web3Provider>
          <CursorPressTracker />
          {children}
          <MusicToggle />
          {/* The battle entry loading screen: at the root so it survives the /dojo → /battle navigation. */}
          <BattleEntryOverlay />
        </Web3Provider>
      </body>
    </html>
  );
}
