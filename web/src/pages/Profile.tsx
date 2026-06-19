import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { CLASS_META, type ClassName } from '@/lib/types';
import { classNames } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit } from '@/lib/units';

const CLASS_OPTIONS: ClassName[] = ['BODYBUILDER', 'POWERLIFTER', 'CALISTHENIST', 'ENDURANCE', 'HYBRID'];

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<{
    class: ClassName;
    heightCm: number | null;
    wristCm: number | null;
    ankleCm: number | null;
    weightKg: number | null;
    bodyFatPct: number | null;
    birthDate: string | null;
  }>>({});

  const system = user?.units ?? 'METRIC';
  const inImperial = system === 'IMPERIAL';
  const [saved, setSaved] = useState(false);

  const updateM = useMutation({
    mutationFn: () =>
      api('/users/me', {
        method: 'PATCH',
        body: {
          class: form.class,
          heightCm: form.heightCm === undefined ? undefined : form.heightCm,
          wristCm: form.wristCm === undefined ? undefined : form.wristCm,
          ankleCm: form.ankleCm === undefined ? undefined : form.ankleCm,
          weightKg: form.weightKg === undefined ? undefined : form.weightKg,
          bodyFatPct: form.bodyFatPct === undefined ? undefined : form.bodyFatPct,
          birthDate: form.birthDate === undefined ? undefined : form.birthDate,
        },
      }),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (!user) return null;

  function val<K extends keyof NonNullable<typeof form>>(key: K): string {
    const v = form[key] as number | null | undefined;
    const raw: number | null = v === undefined
      ? ((user as any)[key as any] as number | null | undefined) ?? null
      : v;
    if (raw == null) return '';
    // Convert stored metric value to display unit if imperial
    if (inImperial) {
      const converted = convertForDisplay(raw, storageUnitForKey(key), 'IMPERIAL');
      return String(converted.value);
    }
    return String(raw);
  }

  function storageUnitForKey(key: string): string {
    if (key === 'heightCm') return 'cm';
    if (key === 'wristCm') return 'cm';
    if (key === 'ankleCm') return 'cm';
    if (key === 'weightKg') return 'kg';
    return '';
  }

  function displayUnitForKey(key: string): string {
    if (inImperial) {
      return displayUnit(storageUnitForKey(key), 'IMPERIAL');
    }
    return storageUnitForKey(key);
  }

  function setNum<K extends keyof NonNullable<typeof form>>(key: K, raw: string) {
    if (raw === '') {
      setForm((f) => ({ ...f, [key]: null }));
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    // If imperial, convert input back to metric for storage
    if (inImperial) {
      const stored = convertForStorage(n, displayUnitForKey(key as string), 'IMPERIAL');
      setForm((f) => ({ ...f, [key]: stored.value }));
    } else {
      setForm((f) => ({ ...f, [key]: n }));
    }
  }

  return (
    <Layout>
      <PageHeader title="// Profile" subtitle="Tune your body metrics. Pick your class." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel variant="cyan" title="Character">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              updateM.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 mb-2">Class</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CLASS_OPTIONS.map((c) => {
                  const m = CLASS_META[c];
                  const selected = (form.class ?? user.class) === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, class: c }))}
                      className={classNames(
                        'p-3 border-2 text-left transition-all',
                        selected
                          ? `border-neon-${m.color}/80 bg-neon-${m.color}/10`
                          : 'border-ink-500/40 hover:border-ink-300'
                      )}
                    >
                      <div className={`font-display tracking-wider text-sm ${selected ? `neon-text-${m.color}` : 'text-ink-200'}`}>
                        {m.label}
                      </div>
                      <div className="text-[10px] text-ink-300 font-mono mt-1">{m.tagline}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                  Height ({displayUnitForKey('heightCm')})
                </label>
                <input className="input-neon" type="number" step="0.1" value={val('heightCm')} onChange={(e) => setNum('heightCm', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                  Wrist ({displayUnitForKey('wristCm')})
                </label>
                <input className="input-neon" type="number" step="0.1" value={val('wristCm')} onChange={(e) => setNum('wristCm', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                  Ankle ({displayUnitForKey('ankleCm')})
                </label>
                <input className="input-neon" type="number" step="0.1" value={val('ankleCm')} onChange={(e) => setNum('ankleCm', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                  Weight ({displayUnitForKey('weightKg')})
                </label>
                <input className="input-neon" type="number" step="0.1" value={val('weightKg')} onChange={(e) => setNum('weightKg', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">Body Fat (%)</label>
                <input className="input-neon" type="number" step="0.1" value={val('bodyFatPct')} onChange={(e) => setNum('bodyFatPct', e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">Birth Date</label>
                <input
                  className="input-neon"
                  type="date"
                  value={val('birthDate') ? new Date(val('birthDate')).toISOString().slice(0, 10) : ''}
                  onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                />
              </div>
            </div>

            <div className="text-[10px] text-ink-300 font-mono">
              Body metrics drive the formula-based genetic maxes (wrist → bicep, height → chest, weight → 1RMs).
              You can override any specific max on the Measurements page.
            </div>

            <div className="flex items-center gap-3">
              <NeonButton type="submit" disabled={updateM.isPending}>
                {updateM.isPending ? 'Saving…' : '⚡ Save'}
              </NeonButton>
              {saved && <span className="text-xs font-mono neon-text-lime">✓ saved</span>}
            </div>
          </form>
        </Panel>

        <Panel variant="magenta" title="Identity">
          <div className="space-y-2 text-sm font-mono">
            <Row k="Callsign" v={user.username} />
            <Row k="Email" v={user.email} />
            <Row k="Class" v={user.class ? CLASS_META[user.class].label : '—'} />
            <Row k="Level" v={String(user.level)} />
            <Row k="Total XP" v={String(user.xp)} />
            <Row k="Gold" v={String(user.gold)} />
          </div>
          <div className="mt-4 text-[10px] text-ink-400 font-mono leading-relaxed border-t border-neon-magenta/20 pt-3">
            // v0.1 // local-first habit RPG // self-host anywhere with docker-compose up
          </div>
        </Panel>
      </div>
    </Layout>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-ink-500/20 pb-1">
      <span className="text-ink-300 text-[10px] uppercase tracking-widest">{k}</span>
      <span className="neon-text-cyan">{v}</span>
    </div>
  );
}
