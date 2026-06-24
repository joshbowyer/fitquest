import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { CollapsibleBlock } from './CollapsibleBlock';
import { NeonButton } from './NeonButton';
import { classNames } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { METRICS, type MetricType } from '@/lib/types';

/**
 * Quick-log blocks for the /today one-stop-shop. Each block is
 * collapsed by default — user clicks to open, sees the current
 * state + inline log form, submits, block auto-closes. State stays
 * in the parent so multiple blocks can be open simultaneously and
 * each tracks its own loading state.
 *
 * The blocks share a single /measurements query so the latest
 * values stay in sync without re-fetching per block. Substance
 * blocks use /substances. Both invalidate the relevant queries on
 * submit so the dashboard widgets (Nutrition, etc.) update.
 */

type MeasurementsResponse = { items: Array<{ id: string; metric: MetricType; value: number; unit: string; recordedAt: string; source: string | null }> };
type SubstancesResponse = { items: Array<{ id: string; category: string; form: string; amount: number | null; unit: string | null; context: string | null; loggedAt: string }> };

export function TodayBlocks({ system }: { system: UnitSystem }) {
  return (
    <div className="space-y-2">
      <WaterBlock system={system} />
      <SleepBlock system={system} />
      <WeighInBlock system={system} />
      <HRVBlock system={system} />
      <CaffeineBlock system={system} />
      <AlcoholBlock system={system} />
    </div>
  );
}

/**
 * One-tap log form. Collapsed header shows the running summary;
 * open body has a quick-pill row (most common values) + free input.
 */
function QuickLogForm({
  primaryLabel,
  pillOptions,
  onSubmit,
  disabled,
  unit,
}: {
  primaryLabel: string;
  pillOptions: Array<{ label: string; value: number }>;
  onSubmit: (value: number) => void;
  disabled?: boolean;
  unit?: string;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {pillOptions.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={disabled}
            onClick={() => onSubmit(p.value)}
            className="px-2.5 py-1 text-[11px] font-mono border border-ink-700/40 text-ink-200 hover:border-neon-cyan/60 hover:text-neon-cyan hover:bg-neon-cyan/5 disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value && !isNaN(Number(value))) {
              onSubmit(Number(value));
              setValue('');
            }
          }}
          placeholder={primaryLabel}
          className="flex-1 bg-bg-900 border border-ink-700/40 px-2 py-1.5 text-xs font-mono rounded"
          disabled={disabled}
        />
        {unit && (
          <span className="text-[10px] font-mono text-ink-400">{unit}</span>
        )}
        <button
          type="button"
          disabled={disabled || !value || isNaN(Number(value))}
          onClick={() => {
            onSubmit(Number(value));
            setValue('');
          }}
          className="px-3 py-1.5 text-xs font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed rounded"
        >
          Log
        </button>
      </div>
    </div>
  );
}

/**
 * Water block. Reads WATER_ML rows for today, shows running total
 * vs. user.targets.waterMl, +250 / +500 / +750 ml quick pills, free
 * input in ml (stored as-is; conversion to fl oz is display-only).
 */
function WaterBlock({ system }: { system: UnitSystem }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const targetMl = user?.targets?.waterGoalMl ?? 2500;
  const q = useQuery({
    queryKey: ['today', 'water'],
    queryFn: () => api<MeasurementsResponse>('/measurements?metric=WATER_ML&limit=200'),
    refetchInterval: 60_000,
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let total = 0;
  let lastAt: string | null = null;
  for (const m of q.data?.items ?? []) {
    if (new Date(m.recordedAt) < today) continue;
    total += m.value;
    if (!lastAt || m.recordedAt > lastAt) lastAt = m.recordedAt;
  }
  const totalDisp = convertForDisplay(total, 'ml', system);
  const pct = Math.min(100, Math.round((total / targetMl) * 100));
  const logM = useMutation({
    mutationFn: (ml: number) =>
      api<{ id: string }>('/measurements', {
        method: 'POST',
        body: { metric: 'WATER_ML', value: ml, unit: 'ml', source: 'MANUAL' },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'water'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'water', 'today'] });
    },
  });
  return (
    <CollapsibleBlock
      title="Water"
      accent="cyan"
      summary={
        <>
          <span className="text-ink-100">{totalDisp.value.toFixed(0)} {totalDisp.unit}</span>
          <span className="text-ink-500 ml-2">· {pct}% of {targetMl}ml</span>
        </>
      }
    >
      <QuickLogForm
        primaryLabel="ml"
        pillOptions={[
          { label: '+250 ml', value: 250 },
          { label: '+500 ml', value: 500 },
          { label: '+750 ml', value: 750 },
        ]}
        onSubmit={(v) => logM.mutate(v)}
        disabled={logM.isPending}
        unit="ml"
      />
    </CollapsibleBlock>
  );
}

/**
 * Sleep block. Two metrics stacked: hours (number) + quality (1-10).
 * Each has its own inline form. Shows latest logged values.
 */
function SleepBlock({ system }: { system: UnitSystem }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['today', 'sleep'],
    queryFn: () =>
      api<MeasurementsResponse>(
        '/measurements?metric=SLEEP_HOURS&metric=SLEEP_QUALITY&limit=200',
      ),
    refetchInterval: 60_000,
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let hours: number | null = null;
  let hoursAt: string | null = null;
  let quality: number | null = null;
  let qualityAt: string | null = null;
  for (const m of q.data?.items ?? []) {
    if (new Date(m.recordedAt) < today) continue;
    if (m.metric === 'SLEEP_HOURS' && (!hoursAt || m.recordedAt > hoursAt)) {
      hours = m.value;
      hoursAt = m.recordedAt;
    } else if (m.metric === 'SLEEP_QUALITY' && (!qualityAt || m.recordedAt > qualityAt)) {
      quality = m.value;
      qualityAt = m.recordedAt;
    }
  }
  const hoursDisp = hours != null ? convertForDisplay(hours, 'h', system) : null;
  const logM = useMutation({
    mutationFn: (b: { metric: 'SLEEP_HOURS' | 'SLEEP_QUALITY'; value: number; unit: string }) =>
      api<{ id: string }>('/measurements', { method: 'POST', body: { ...b, source: 'MANUAL' } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'sleep'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  });
  return (
    <CollapsibleBlock
      title="Sleep"
      accent="lime"
      summary={
        <>
          {hoursDisp && <span className="text-ink-100">{hoursDisp.value.toFixed(1)} h</span>}
          {quality != null && <span className="text-ink-100 ml-2">· quality {quality}/10</span>}
          {!hoursDisp && quality == null && <span className="text-ink-500">not logged</span>}
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
            Hours
          </div>
          <QuickLogForm
            primaryLabel="hours"
            pillOptions={[
              { label: '6h', value: 6 },
              { label: '7h', value: 7 },
              { label: '8h', value: 8 },
              { label: '9h', value: 9 },
            ]}
            onSubmit={(v) => logM.mutate({ metric: 'SLEEP_HOURS', value: v, unit: 'h' })}
            disabled={logM.isPending}
            unit="h"
          />
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
            Quality (1–10)
          </div>
          <QualityPills
            disabled={logM.isPending}
            onSubmit={(v) => logM.mutate({ metric: 'SLEEP_QUALITY', value: v, unit: '/10' })}
          />
        </div>
      </div>
    </CollapsibleBlock>
  );
}

function QualityPills({ disabled, onSubmit }: { disabled?: boolean; onSubmit: (v: number) => void }) {
  return (
    <div className="grid grid-cols-10 gap-1">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(n)}
          className="h-8 text-sm font-mono border border-ink-700/40 text-ink-200 hover:border-neon-lime/60 hover:text-neon-lime hover:bg-neon-lime/5 disabled:opacity-50 disabled:cursor-not-allowed rounded"
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/**
 * Weigh-in block. Daily recommended but not required — user can log
 * weekly. Shows last logged value + inline input.
 */
function WeighInBlock({ system }: { system: UnitSystem }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['today', 'weight'],
    queryFn: () => api<MeasurementsResponse>('/measurements?metric=WEIGHT&limit=200'),
    refetchInterval: 60_000,
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let lastValue: number | null = null;
  let lastAt: string | null = null;
  for (const m of q.data?.items ?? []) {
    if (!lastAt || m.recordedAt > lastAt) {
      lastValue = m.value;
      lastAt = m.recordedAt;
    }
  }
  const todayLogged = q.data?.items?.some((m) => new Date(m.recordedAt) >= today);
  const logM = useMutation({
    mutationFn: (v: number) =>
      api<{ id: string }>('/measurements', {
        method: 'POST',
        body: { metric: 'WEIGHT', value: v, unit: 'kg', source: 'MANUAL' },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'weight'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  });
  const lastDisp = lastValue != null ? convertForDisplay(lastValue, 'kg', system) : null;
  return (
    <CollapsibleBlock
      title="Weigh-in"
      accent="amber"
      summary={
        todayLogged ? (
          <span className="text-neon-lime">✓ logged today</span>
        ) : lastDisp ? (
          <span className="text-ink-100">last: {lastDisp.value.toFixed(1)} {lastDisp.unit}</span>
        ) : (
          <span className="text-ink-500">not logged</span>
        )
      }
    >
      <QuickLogForm
        primaryLabel={displayUnit('kg', system)}
        pillOptions={[]}
        onSubmit={(v) => logM.mutate(v)}
        disabled={logM.isPending}
        unit={displayUnit('kg', system)}
      />
    </CollapsibleBlock>
  );
}

/**
 * HRV block. Single number input.
 */
function HRVBlock({ system: _system }: { system: UnitSystem }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['today', 'hrv'],
    queryFn: () => api<MeasurementsResponse>('/measurements?metric=HRV&limit=200'),
    refetchInterval: 60_000,
  });
  let last: number | null = null;
  let lastAt: string | null = null;
  for (const m of q.data?.items ?? []) {
    if (!lastAt || m.recordedAt > lastAt) {
      last = m.value;
      lastAt = m.recordedAt;
    }
  }
  const logM = useMutation({
    mutationFn: (v: number) =>
      api<{ id: string }>('/measurements', {
        method: 'POST',
        body: { metric: 'HRV', value: v, unit: 'ms', source: 'MANUAL' },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'hrv'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  });
  return (
    <CollapsibleBlock
      title="HRV"
      accent="violet"
      summary={
        last != null ? (
          <span className="text-ink-100">{last.toFixed(0)} ms</span>
        ) : (
          <span className="text-ink-500">not logged</span>
        )
      }
    >
      <QuickLogForm
        primaryLabel="ms"
        pillOptions={[]}
        onSubmit={(v) => logM.mutate(v)}
        disabled={logM.isPending}
        unit="ms"
      />
    </CollapsibleBlock>
  );
}

/**
 * Caffeine block. Counts espressos in last 24h. Pills for common
 * forms (espresso, coffee, tea, energy drink).
 */
function CaffeineBlock({ system: _system }: { system: UnitSystem }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['today', 'caffeine'],
    queryFn: () => api<SubstancesResponse>('/substances?days=1'),
    refetchInterval: 60_000,
  });
  let count = 0;
  for (const s of q.data?.items ?? []) {
    if (s.category !== 'CAFFEINE') continue;
    // Treat each entry as one serving regardless of amount
    count += 1;
  }
  const logM = useMutation({
    mutationFn: (b: { form: string; amount?: number; context?: string }) =>
      api<{ id: string }>('/substances', { method: 'POST', body: { category: 'CAFFEINE', ...b } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'caffeine'] });
      qc.invalidateQueries({ queryKey: ['substances'] });
    },
  });
  return (
    <CollapsibleBlock
      title="Caffeine"
      accent="amber"
      summary={
        <span className="text-ink-100">
          {count} {count === 1 ? 'serving' : 'servings'} · last 24h
        </span>
      }
    >
      <QuickLogForm
        primaryLabel="form (e.g. espresso)"
        pillOptions={[
          { label: 'espresso', value: 1 },
          { label: 'coffee', value: 1 },
          { label: 'tea', value: 1 },
          { label: 'energy drink', value: 1 },
        ]}
        onSubmit={() => logM.mutate({ form: 'unspecified', context: 'quick-log' })}
        disabled={logM.isPending}
      />
    </CollapsibleBlock>
  );
}

/**
 * Alcohol block. Counts drinks in last 7d. Pills for common forms.
 */
function AlcoholBlock({ system: _system }: { system: UnitSystem }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['today', 'alcohol'],
    queryFn: () => api<SubstancesResponse>('/substances?days=7'),
    refetchInterval: 60_000,
  });
  let count = 0;
  for (const s of q.data?.items ?? []) {
    if (s.category !== 'ALCOHOL') continue;
    count += 1;
  }
  const logM = useMutation({
    mutationFn: (b: { form: string }) =>
      api<{ id: string }>('/substances', { method: 'POST', body: { category: 'ALCOHOL', ...b } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'alcohol'] });
      qc.invalidateQueries({ queryKey: ['substances'] });
    },
  });
  return (
    <CollapsibleBlock
      title="Alcohol"
      accent="magenta"
      summary={
        <span className="text-ink-100">
          {count} {count === 1 ? 'drink' : 'drinks'} · last 7d
        </span>
      }
    >
      <QuickLogForm
        primaryLabel="form (e.g. wine)"
        pillOptions={[
          { label: 'wine', value: 1 },
          { label: 'beer', value: 1 },
          { label: 'spirit', value: 1 },
        ]}
        onSubmit={(v) => logM.mutate({ form: 'unspecified' })}
        disabled={logM.isPending}
      />
    </CollapsibleBlock>
  );
}
