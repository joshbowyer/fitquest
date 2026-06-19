import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { convertForDisplay, type UnitSystem } from '@/lib/units';
import { formatRelative } from '@/lib/format';
import type { Measurement } from '@/lib/types';

const LEAN_TARGETS: Record<string, number> = {
  // cm — for a 5'11" small-framed meso at ~10% BF, contest waist is ~29-30"
  // (Grok/Casey Butt). For larger frames, scale up slightly. These are
  // aspirational — most naturals reach 80-90% of this.
  MALE_DEFAULT: 81, // ~32 in
  FEMALE_DEFAULT: 71, // ~28 in
};

export function WaistDisplay() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const q = useQuery({
    queryKey: ['measurements', 'latest'],
    queryFn: () => api<{ items: Measurement[] }>('/measurements/latest'),
  });
  const latest = (q.data?.items || []).find((m) => m.metric === 'WAIST');
  const value = latest?.value ?? null;
  const recordedAt = latest?.recordedAt ?? null;

  // Pick lean target based on... hmm, we don't have sex. For now use male default.
  const target = LEAN_TARGETS.MALE_DEFAULT;
  const pct = value != null ? Math.max(0, Math.min(1, value / target)) : null;

  return (
    <div className="mt-3 border border-neon-lime/30 bg-neon-lime/5 p-3">
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-neon-lime">
            Waist · lean metric
          </div>
          <div className="text-[10px] text-ink-300 font-mono mt-0.5">
            Lower = leaner. No genetic max.
          </div>
        </div>
        <div className="text-right">
          {value != null ? (
            <>
              <div className="font-display text-2xl neon-text-lime leading-none">
                {(() => {
                  const d = convertForDisplay(value, 'cm', system);
                  return `${d.value.toFixed(1)} ${d.unit}`;
                })()}
              </div>
              <div className="text-[10px] text-ink-300 font-mono mt-1">
                {recordedAt ? formatRelative(recordedAt) : '—'}
              </div>
            </>
          ) : (
            <Link to="/measurements" className="btn-ghost text-[10px]">
              + Log
            </Link>
          )}
        </div>
      </div>
      {pct != null && (
        <div>
          <div className="flex justify-between text-[9px] font-mono text-ink-300 mb-0.5">
            <span>0</span>
            <span>contest lean</span>
          </div>
          <div className="h-1.5 bg-bg-700 border border-ink-500/30 overflow-hidden">
            <div
              className="h-full bg-neon-lime transition-all duration-700"
              style={{ width: `${pct * 100}%`, boxShadow: '0 0 4px currentColor' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
