import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { classNames } from '@/lib/format';
import type {
  PortalLeak as PortalLeakData,
  PortalLeakResponse,
} from '@/lib/types';

// =============================================================================
// Portal Leak card — companion to HomeBaseCard on the dashboard.
//
// Shows:
//  - No leak: small placeholder with the spawn threshold ("spawns at
//    <60 shield"); pulls /portal-leak/check-spawn on mount so a leak
//    that should be there appears immediately without the user having
//    to navigate.
//  - Active leak: monster name, HP bar, intro line, "Last 36h" recent
//    damage feed, and a CTA to /portal-leak for attack + claim controls.
//  - Defeated leak: loot claim button + flavour line.
// =============================================================================

const SPAWN_TIER_TEXT = {
  FORTIFIED:   'Shield secure. No leaks will spawn.',
  STABLE:      'Stable — leaks are rare (≈5%).',
  COMPROMISED: 'Compromised — leaks roll every 20% on each breach.',
  BREACHED:    'BREACHED — leaks roll every 50% on each breach.',
};

export function PortalLeakCard() {
  const qc = useQueryClient();
  const leakQ = useQuery({
    queryKey: ['portal-leak'],
    queryFn: () => api<PortalLeakResponse>('/portal-leak'),
    // Refresh every 60s so a leak born from another tab / the
    // nightly cron shows up without a manual reload.
    refetchInterval: 60_000,
  });

  const shieldQ = useQuery({
    queryKey: ['home-base', 'shield-tier'],
    queryFn: () => api<{ tier: 'FORTIFIED' | 'STABLE' | 'COMPROMISED' | 'BREACHED' }>('/home-base/summary'),
    staleTime: 60_000,
  });

  // Auto-trigger the spawn check whenever this card mounts. The
  // server returns `leak: null` if nothing spawns, so a few extra
  // calls are harmless.
  useEffect(() => {
    const me = (shieldQ.data?.tier ?? 'FORTIFIED') as keyof typeof SPAWN_TIER_TEXT;
    // Skip the spawn probe at FORTIFIED — server short-circuits
    // anyway, but skipping saves a round-trip and a wasted log line.
    if (me === 'FORTIFIED') return;
    void api('/portal-leak/check-spawn', { method: 'POST', body: { shieldScore: 0 } })
      .then(() => qc.invalidateQueries({ queryKey: ['portal-leak'] }))
      .catch(() => {/* ignore — non-fatal */});
    // We only depend on the mount + tier. Re-triggering on tier change
    // would let the user re-roll the spawn by toggling shield tier
    // (they can't), so we only watch the tier field on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leak = leakQ.data?.leak ?? null;
  const recent = leakQ.data?.recent ?? [];
  const tier = shieldQ.data?.tier;

  // ACTIVE: render the leak card with HP bar + recent feed.
  if (leak && leak.status === 'ACTIVE') {
    const pct = Math.max(0, Math.min(100, (leak.hp / leak.maxHp) * 100));
    return (
      <Panel
        variant="magenta"
        title={
          <div className="flex items-center gap-2">
            <span style={{ color: leak.monsterColor }}>{leak.monsterEmoji}</span>
            <span>{leak.monsterName}</span>
          </div>
        }
        action={
          <Link
            to="/portal-leak"
            className="text-[10px] font-mono uppercase tracking-widest text-ink-300 hover:text-neon-magenta hover:underline"
          >
            FIGHT →
          </Link>
        }
      >
        <PortalLeakBody leak={leak} pct={pct} recent={recent} compact />
      </Panel>
    );
  }

  // DEFEATED: loot claim CTA.
  if (leak && leak.status === 'DEFEATED') {
    return <PortalLeakClaimCard leak={leak} onClaimed={() => qc.invalidateQueries({ queryKey: ['portal-leak'] })} />;
  }

  // OVERWHELMED / EXPIRED: quiet card explaining what happened, link
  // to history page.
  if (leak && (leak.status === 'OVERWHELMED' || leak.status === 'EXPIRED')) {
    return (
      <Panel variant="magenta" title="Leak resolved">
        <div className="text-[11px] font-mono text-ink-300 italic">
          {leak.resolvedReason || 'The encounter ended.'}
        </div>
        <Link
          to="/portal-leak"
          className="block mt-2 text-[10px] font-display tracking-widest neon-text-magenta hover:underline"
        >
          → VIEW HISTORY
        </Link>
      </Panel>
    );
  }

  // No leak. Show shield-tier-aware placeholder.
  return (
    <Panel variant="magenta" title="Portal leak" action={<Link to="/portal-leak" className="text-[10px] font-mono text-ink-300 hover:text-neon-magenta">→</Link>}>
      <div className="space-y-2">
        <div className="text-[11px] font-mono text-ink-300 italic">
          {tier ? SPAWN_TIER_TEXT[tier] : 'Shield secure. No leaks will spawn.'}
        </div>
        <div className="text-[10px] font-mono text-ink-500 leading-relaxed">
          Leaks are 1-shot home-base encounters — deal damage by logging workouts that match the leak's preferred muscles, defeat to claim loot.
        </div>
      </div>
    </Panel>
  );
}

// Shared body used by both the dashboard card (compact) and the
// /portal-leak page (full). The `compact` flag hides the CTA + recent
// feed labels for the dashboard widget.
export function PortalLeakBody({
  leak,
  pct,
  recent,
  compact = false,
}: {
  leak: PortalLeakData;
  pct: number;
  recent: Array<{ id: string; damage: number; matchType: string; createdAt: string }>;
  compact?: boolean;
}) {
  // Map the display name (e.g. "The Crawler") to the sprite slug
  // (e.g. "crawler"). Both come from the same LEAK_MONSTERS list
  // in api/src/lib/portalLeaks.ts so this mapping is stable.
  const monsterSlug = leak.monsterName.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '') || 'unknown';
  return (
    <div className="space-y-3">
      {/* Monster portrait — square 96px, sits above the intro.
          The image is transparent so the dark panel background
          shows through, and a soft drop-shadow uses the monster's
          signature color for a tinted glow. */}
      <div className="flex justify-center">
        <img
          src={`/sprites/monsters/${monsterSlug}.png`}
          alt={leak.monsterName}
          width={96}
          height={96}
          className="block"
          style={{
            width: 96,
            height: 96,
            filter: `drop-shadow(0 0 12px ${leak.monsterColor}88)`,
            imageRendering: 'pixelated',
          }}
        />
      </div>
      <div className="text-[11px] font-mono italic text-ink-300 leading-snug">
        {leak.intro}
      </div>
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
            {compact ? 'HP' : 'Hit points'}
          </span>
          <span className="text-xs font-display tabular-nums" style={{ color: leak.monsterColor }}>
            {leak.hp} / {leak.maxHp}
          </span>
        </div>
        <div className="relative h-3 rounded bg-bg-900 border border-ink-700/40 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all"
            style={{ width: `${pct}%`, backgroundColor: leak.monsterColor, boxShadow: `0 0 8px ${leak.monsterColor}88` }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1 text-[10px] font-mono">
        <span className="text-ink-500">preferred:</span>
        {leak.preferredTags.map((t) => (
          <span
            key={t}
            className="px-1.5 border border-neon-magenta/40 text-neon-magenta"
            title="Workouts hitting this tag deal damage"
          >
            {t}
          </span>
        ))}
        {leak.bonusTags.length > 0 && (
          <>
            <span className="text-ink-500 ml-2">bonus:</span>
            {leak.bonusTags.map((t) => (
              <span
                key={t}
                className="px-1.5 border border-neon-amber/40 text-neon-amber"
                title="Bonus damage on rare-tag matches"
              >
                {t}
              </span>
            ))}
          </>
        )}
      </div>
      {!compact && recent.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
            Recent damage
          </div>
          <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {recent.slice(0, 8).map((d) => (
              <div key={d.id} className="flex items-center justify-between text-[10px] font-mono">
                <span
                  className={classNames(
                    d.damage > 0 ? 'text-neon-magenta' : 'text-rose-400',
                  )}
                >
                  {d.damage > 0 ? `−${d.damage}` : `+${Math.abs(d.damage)}`}
                </span>
                <span className="text-ink-500">{d.matchType}</span>
                <span className="text-ink-400">{new Date(d.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PortalLeakClaimCard({
  leak,
  onClaimed,
}: {
  leak: PortalLeakData;
  onClaimed: () => void;
}) {
  const claimM = useDelayedMutation<{ item: { name: string; rarity: string } }, string>({
    mutationFn: (leakId) => api(`/portal-leak/${leakId}/claim`, { method: 'POST', body: {} }),
    onSuccess: () => onClaimed(),
  }, 500);

  return (
    <Panel
      variant="magenta"
      title={
        <div className="flex items-center gap-2">
          <span style={{ color: leak.monsterColor }}>{leak.monsterEmoji}</span>
          <span>{leak.monsterName} defeated</span>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="text-[11px] font-mono italic text-ink-200 leading-snug">
          {leak.resolvedReason || 'The leak sealed shut.'}
        </div>
        {leak.itemDrop ? (
          <div className="text-[11px] font-mono text-neon-amber">
            ⤓ Loot is ready to claim.
          </div>
        ) : (
          <div className="text-[11px] font-mono text-ink-400">
            Already claimed.
          </div>
        )}
        <div className="flex gap-2">
          {leak.itemDrop && (
            <NeonButton
              variant="amber"
              size="sm"
              loading={claimM.isPending}
              onClick={() => claimM.run(leak.id)}
            >
              Claim loot
            </NeonButton>
          )}
          <NeonButton variant="cyan" size="sm" onClick={onClaimed}>
            Dismiss
          </NeonButton>
        </div>
        {claimM.error && (
          <div className="text-[10px] font-mono text-rose-300">
            {claimM.error instanceof Error ? claimM.error.message : 'Claim failed'}
          </div>
        )}
      </div>
    </Panel>
  );
}