import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon/coming-soon';

/** Nzib's Coming Soon — every gated page is rewritten here (middleware.ts, lib/site-gate.ts). */
export const metadata: Metadata = { title: 'Clawbada · Coming Soon' };

export default function ComingSoonPage() {
  return <ComingSoon />;
}
