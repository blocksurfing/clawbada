'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { api } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { useAuth } from '@/hooks/use-auth';
import { getArenaBackground } from '@/lib/assets';
import { BOT_CATALOG, DEFAULT_BOT, botInfo, type BotName } from '@/lib/bot-catalog';
import { Swords, Loader2, Dumbbell } from 'lucide-react';

/**
 * The dojo: build any three-class team at any tier and purity and fight a bot with it.
 *
 * Off-chain like every practice battle — no stakes, no rating, no repair. It speaks the API's
 * `team_<a>_<b>_<c>_<tier>` preset plus `purity`, which the API keeps open even when the dev
 * presets are switched off. The quick-start Practice tab on /game/battle is separate and
 * unchanged; the harness and the designer's `?preset=` deep links depend on it.
 *
 * Bots come from lib/bot-catalog.ts: easiest first, each with how it plays and what it teaches.
 *
 * Deep links: ?class=kraken (three of one class) or ?team=kraken,ember,abyss, plus
 * ?tier= ?purity= ?bot= ?arena= ?opponent=. Review params ?auto= ?speed= ?stay= are carried
 * through to the battle page, as on the Practice tab.
 */

const CLASSES = CLASS_NAMES_LIST.map((n) => n.toLowerCase());
const TIERS = ['evolved', 'elite', 'apex'] as const;
type Tier = (typeof TIERS)[number];
type Arena = 'match' | Tier;

// Showcase by default (user decision 2026-09-21): Apex rigs are the best-looking assets and
// purity 6 fires the enhanced Special about one cast in three (5% + 5% × purity = 35%).
const DEFAULT_TEAM = ['kraken', 'ember', 'abyss'];
const DEFAULT_TIER: Tier = 'apex';
const DEFAULT_PURITY = 6;

const arenaScene = getArenaBackground(3);

const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
const chip = (on: boolean) =>
  `px-3 py-1.5 rounded text-xs font-pixel border ${on ? 'border-claw-gold text-claw-gold bg-claw-gold/10' : 'border-border text-text-secondary hover:text-foreground'}`;

export default function DojoPage() {
  const { address } = useAccount();
  const router = useRouter();
  const { getAuthHeaders } = useAuth();
  const [team, setTeam] = useState<string[]>(DEFAULT_TEAM);
  const [tier, setTier] = useState<Tier>(DEFAULT_TIER);
  const [purity, setPurity] = useState(DEFAULT_PURITY);
  const [bot, setBot] = useState<BotName>(DEFAULT_BOT);
  const [opponent, setOpponent] = useState<'mirror' | 'random'>('mirror');
  const [arena, setArena] = useState<Arena>('match');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const one = q.get('class');
    const many = q.get('team')?.split(',');
    if (one && CLASSES.includes(one)) setTeam([one, one, one]);
    else if (many?.length === 3 && many.every((c) => CLASSES.includes(c))) setTeam(many);
    const t = q.get('tier');
    if (t && (TIERS as readonly string[]).includes(t)) setTier(t as Tier);
    const p = Number(q.get('purity'));
    if (q.has('purity') && Number.isInteger(p) && p >= 0 && p <= 6) setPurity(p);
    const b = q.get('bot');
    if (b && botInfo(b)) setBot(b as BotName);
    const a = q.get('arena');
    if (a && (TIERS as readonly string[]).includes(a)) setArena(a as Tier);
    const o = q.get('opponent');
    if (o === 'mirror' || o === 'random') setOpponent(o);
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const auth = await getAuthHeaders();
      const base = { preset: `team_${team.join('_')}_${tier}`, purity, bot, opponent };
      const res = await api.combat.createPractice(arena === 'match' ? base : { ...base, arena }, auth);
      const q = new URLSearchParams(window.location.search);
      const carry = new URLSearchParams();
      for (const k of ['auto', 'speed', 'stay']) { const v = q.get(k); if (v) carry.set(k, v); }
      router.push(`/battle/${res.battleId}${carry.size ? `?${carry}` : ''}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the dojo battle');
      setBusy(false);
    }
  }, [team, tier, purity, bot, opponent, arena, getAuthHeaders, router]);

  if (!address) {
    return (
      <PageBackground variant="deep" scene={arenaScene} sceneDark>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Swords className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Dojo</h1>
          <p className="text-sm text-text-secondary">Connect your wallet to train. Nothing is staked and nothing is on-chain; the wallet only proves who you are.</p>
        </div>
      </PageBackground>
    );
  }

  return (
    <PageBackground variant="deep" scene={arenaScene} sceneDark>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <Dumbbell className="size-6 text-teal" />
            <h1 className="font-pixel text-xl text-foreground">Dojo</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Build any team and train against a bot. Off-chain: no stakes, no rating, no repair. Want your own lobsters instead? Use{' '}
            <Link href="/game/battle" className="text-ocean hover:underline">Practice</Link>.
          </p>
        </div>

        <FrostedPanel className="space-y-5">
          <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Your team</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="dojo-classes">
            {team.map((cls, i) => (
              <Select key={i} value={cls} onValueChange={(v) => setTeam((t) => t.map((c, j) => (j === i ? v : c)))}>
                <SelectTrigger className="bg-ocean-mid/50 border-border" aria-label={`Lobster ${i + 1} class`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLASSES.map((c) => <SelectItem key={c} value={c}>{label(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-sm text-text-secondary block">Tier</label>
            <div className="flex flex-wrap gap-2" data-testid="dojo-tier">
              {TIERS.map((t) => <button key={t} onClick={() => setTier(t)} className={chip(tier === t)}>{label(t)}</button>)}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-text-secondary block">Purity: {purity}/6</label>
            <div className="flex flex-wrap gap-2" data-testid="dojo-purity">
              {[0, 1, 2, 3, 4, 5, 6].map((p) => <button key={p} onClick={() => setPurity(p)} className={chip(purity === p)}>{p}</button>)}
            </div>
            <p className="text-xs text-text-secondary">
              Specials hit {100 + 10 * purity}% as hard and fire their enhanced version {5 + 5 * purity}% of the time.
              Real lobsters are mostly Base or Evolved at purity 0–1, so the default Apex/Pure team is a showcase, not what a real match looks like.
            </p>
          </div>
        </FrostedPanel>

        <FrostedPanel className="space-y-5">
          <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Opponent</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-text-secondary">Bot</label>
              <Select value={bot} onValueChange={(v) => setBot(v as BotName)}>
                <SelectTrigger className="bg-ocean-mid/50 border-border" data-testid="dojo-bot"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BOT_CATALOG.map((b) => <SelectItem key={b.name} value={b.name}>{b.label} · {b.difficulty}</SelectItem>)}
                </SelectContent>
              </Select>
              {botInfo(bot) && (
                <div className="text-xs space-y-1" data-testid="dojo-bot-info">
                  <p className="text-foreground">{botInfo(bot)!.plays}</p>
                  <p className="text-text-secondary">Lesson: {botInfo(bot)!.teaches}</p>
                </div>
              )}
              <label className="text-sm text-text-secondary block pt-1">Opponent roster</label>
              <div className="flex gap-2">
                {(['mirror', 'random'] as const).map((o) => (
                  <button key={o} onClick={() => setOpponent(o)} className={chip(opponent === o)}>
                    {o === 'mirror' ? 'Mirror mine' : 'Random classes'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-secondary">Either way the bot fights at your tier and purity.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-text-secondary">Arena</label>
              <div className="flex flex-wrap gap-2">
                {([['match', 'Match team'], ['evolved', 'Evolved'], ['elite', 'Elite'], ['apex', 'Apex']] as const).map(([a, text]) => (
                  <button key={a} onClick={() => setArena(a)} className={chip(arena === a)}>{text}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[rgba(255,210,128,0.1)]">
            <span className="text-xs text-text-secondary">{err ?? `${team.map(label).join(' · ')}, ${label(tier)}, purity ${purity} vs ${botInfo(bot)?.label ?? bot}`}</span>
            <button
              onClick={start}
              disabled={busy}
              className="frosted-panel-highlight px-4 py-2 text-xs font-pixel text-claw-gold hover:border-[rgba(255,210,128,0.3)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              {busy ? 'Starting…' : 'Train'}
            </button>
          </div>
        </FrostedPanel>
      </div>
    </PageBackground>
  );
}
