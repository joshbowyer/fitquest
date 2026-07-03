import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { classNames, formatRelative } from '@/lib/format';

// Bridge-import summary — groups bridge-ingested workouts by
// local-date so the user can see "today I got 3 activities via
// the bridge" at a glance.
type BridgeSummary = {
  days: number;
  totalCount: number;
  groups: Array<{
    date: string;
    count: number;
    totalDurationMin: number;
    items: Array<{
      id: string;
      name: string | null;
      notes: string | null;
      performedAt: string;
      duration: number | null;
    }>;
  }>;
};

// Per-file history of every .fit the bridge has uploaded.
// Items are unioned across Workout + Measurement + DailyLog
// so a single file that produced 1 workout + 3 measurements +
// 2 daily-logs shows all 6 rows under the same filename.
type BridgeHistoryItem =
  | { kind: 'workout'; id: string; name: string | null; duration: number | null; performedAt: string; notes: string | null }
  | { kind: 'measurement'; id: string; metric: string; value: number; unit: string; recordedAt: string; notes: string | null }
  | { kind: 'daily_log'; id: string; dailyKey: string; loggedAt: string; goldDelta: number; xpDelta: number };
type BridgeHistory = {
  totalFiles: number;
  totalItems: number;
  files: Array<{
    filename: string;
    firstAt: string;
    lastAt: string;
    counts: { workout: number; measurement: number; daily_log: number };
    items: BridgeHistoryItem[];
  }>;
};

type FitKind = 'activity' | 'sleep' | 'hrv' | 'monitor' | 'metrics' | 'unknown';

type CreatedRecord =
  | { kind: 'workout'; id: string; summary: string }
  | { kind: 'measurement'; metric: string; id: string; value: number }
  | { kind: 'daily_log'; id: string; dailyKey: string };

type FileResult = {
  filename: string;
  fitKind: FitKind;
  sourceTimestamp: string | null;
  created: CreatedRecord[];
  skipped: { reason: string }[];
};

type BatchResponse = { files: FileResult[] };

type ImportSummary = {
  recentWorkouts: Array<{ id: string; name: string | null; notes: string | null; performedAt: string; duration: number | null }>;
  recentSleep: Array<{ id: string; value: number; recordedAt: string }>;
  recentHrv: Array<{ id: string; value: number; recordedAt: string; notes: string | null }>;
};

const KIND_LABEL: Record<FitKind, { label: string; color: string; icon: string }> = {
  activity: { label: 'Activity', color: '#f55cc4', icon: '⚔' },
  sleep:    { label: 'Sleep',    color: '#cba6ff', icon: '☾' },
  hrv:      { label: 'HRV',      color: '#14d6e8', icon: '◉' },
  monitor:  { label: 'Monitor',  color: '#ffc34d', icon: '◆' },
  metrics:  { label: 'Metrics',  color: '#9bff5c', icon: '◇' },
  unknown:  { label: 'Unknown',  color: '#7f7f9c', icon: '?' },
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as ArrayBuffer;
      // Convert ArrayBuffer to base64 in chunks to avoid stack overflow on large files.
      const bytes = new Uint8Array(result);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  });
}

export function ImportPage() {
  const qc = useQueryClient();
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  // Collapsed-by-default for the persistent bridge-uploads history
  // (the 'pending unlocks' panel above is about activity→skill
  // matching — different data source).
  const [bridgeHistoryOpen, setBridgeHistoryOpen] = useState(false);
  // Per-file expanded state. Map<filename, boolean>.
  const [bridgeFileOpen, setBridgeFileOpen] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);

  const summaryQ = useQuery({
    queryKey: ['import', 'summary'],
    queryFn: () => api<ImportSummary>('/import/summary'),
    refetchInterval: 30_000,
  });
  // Bridge-import summary. Polled less aggressively than the
  // manual summary since the bridge uploads in bursts and we
  // don't want a hammer of /import/bridge-summary every 30s.
  const bridgeQ = useQuery({
    queryKey: ['import', 'bridge-summary'],
    queryFn: () => api<BridgeSummary>('/import/bridge-summary', { query: { days: 14 } }),
    refetchInterval: 60_000,
  });

  // Full bridge-history: every bridge-uploaded Workout the
  // user has, grouped by sourceFilename. Rendered below the
  // pending-unlock panel as a collapsed-by-default list so it
  // doesn't dominate the page.
  const bridgeHistoryQ = useQuery({
    queryKey: ['import', 'bridge-history'],
    queryFn: () => api<BridgeHistory>('/import/bridge-history'),
    refetchInterval: 60_000,
  });

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setError(null);
      setUploading(true);
      setResults(null);
      try {
        const payload = await Promise.all(
          arr.map(async (f) => ({
            filename: f.name,
            contentBase64: await readFileAsBase64(f),
          })),
        );
        const res = await api<BatchResponse>('/import/batch', {
          method: 'POST',
          body: { files: payload },
        });
        setResults(res.files);
        qc.invalidateQueries({ queryKey: ['workouts'] });
        qc.invalidateQueries({ queryKey: ['measurements'] });
        qc.invalidateQueries({ queryKey: ['dailies'] });
        qc.invalidateQueries({ queryKey: ['achievements'] });
        qc.invalidateQueries({ queryKey: ['recovery'] });
        qc.invalidateQueries({ queryKey: ['import', 'summary'] });
        // A FIT import can create Measurement rows for sleep / HRV /
        // stress / soreness. The dashboard's Morning checkin cards
        // derive from those — refresh so today's logs clear.
        qc.invalidateQueries({ queryKey: ['check-ins'] });
      } catch (e: any) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [qc],
  );

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleFiles(e.target.files);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }

  const totals = results
    ? {
        imported: results.filter((r) => r.fitKind !== 'unknown').length,
        skipped: results.filter((r) => r.fitKind === 'unknown' || r.skipped.length > 0).length,
        workouts: results.reduce((s, r) => s + r.created.filter((c) => c.kind === 'workout').length, 0),
        measurements: results.reduce((s, r) => s + r.created.filter((c) => c.kind === 'measurement').length, 0),
      }
    : null;

  return (
    <Layout>
      <PageHeader
        title="// Import"
        subtitle="Manual FIT uploads. Drop a file or many — activities become Activities, sleep + HRV become Measurements."
        action={
          <NeonButton onClick={() => inputRef.current?.click()} variant="cyan" icon="↥">
            Choose files
          </NeonButton>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".fit,application/octet-stream"
        multiple
        onChange={onPickFiles}
        style={{ display: 'none' }}
      />

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={classNames(
          'border-2 border-dashed p-8 text-center transition-all cursor-pointer',
          dragOver
            ? 'border-neon-cyan/80 bg-neon-cyan/10'
            : 'border-ink-500/40 bg-bg-800/60 hover:border-neon-cyan/50',
        )}
        onClick={() => inputRef.current?.click()}
      >
        <div className="text-4xl mb-2">{uploading ? '⏳' : '↥'}</div>
        <div className="font-display tracking-widest text-base text-ink-100">
          {uploading ? 'Uploading…' : 'Drop .fit files here'}
        </div>
        <div className="text-[10px] font-mono text-ink-400 mt-2">
          Or click to choose. Supports activities, sleep, HRV, and monitoring FITs from Garmin wearables and Gadgetbridge.
        </div>
      </div>

      {error && (
        <div className="mt-4 border border-neon-magenta/50 bg-neon-magenta/5 p-3 text-sm font-mono neon-text-magenta">
          ! {error}
        </div>
      )}

      {/* Result summary */}
      {totals && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Imported" value={totals.imported} accent="#9bff5c" />
          <Stat label="Skipped" value={totals.skipped} accent="#f55cc4" />
          <Stat label="Activities" value={totals.workouts} accent="#14d6e8" />
          <Stat label="Measurements" value={totals.measurements} accent="#ffc34d" />
        </div>
      )}

      {/* Per-file results */}
      {results && results.length > 0 && (
        <Panel title="Results" variant="lime" className="mt-4">
          <div className="space-y-2">
            {results.map((r, i) => {
              const meta = KIND_LABEL[r.fitKind];
              return (
                <div
                  key={i}
                  className="border border-ink-500/30 p-3"
                  style={{
                    borderColor: `${meta.color}55`,
                    background: `${meta.color}05`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base" style={{ color: meta.color }}>{meta.icon}</span>
                    <span className="font-display tracking-wider text-sm" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] font-mono text-ink-300 truncate">
                      {r.filename}
                    </span>
                    {r.sourceTimestamp && (
                      <span className="text-[10px] font-mono text-ink-500 ml-auto">
                        recorded {new Date(r.sourceTimestamp).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {r.created.length > 0 && (
                    <div className="space-y-0.5 mt-1">
                      {r.created.map((c, j) => (
                        <div key={j} className="text-[10px] font-mono text-ink-300">
                          + {c.kind === 'workout' && (
                            <Link to="/activities" className="text-neon-cyan hover:underline">
                              Workout: {c.summary}
                            </Link>
                          )}
                          {c.kind === 'measurement' && (
                            <span className="text-neon-amber">
                              Measurement: {c.metric} = {c.value}
                            </span>
                          )}
                          {c.kind === 'daily_log' && (
                            <span className="text-neon-lime">
                              Daily auto-completed: {c.dailyKey}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {r.skipped.length > 0 && (
                    <div className="text-[10px] font-mono text-ink-400 italic mt-1">
                      {r.skipped.map((s, k) => (
                        <div key={k}>— {s.reason}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Recent imports */}
      <Panel title="Recent imports" variant="violet" className="mt-4">
        {summaryQ.isLoading ? (
          <div className="text-[10px] font-mono text-ink-300">loading…</div>
        ) : !summaryQ.data ||
          (summaryQ.data.recentWorkouts.length === 0 &&
            summaryQ.data.recentSleep.length === 0 &&
            summaryQ.data.recentHrv.length === 0) ? (
          <div className="text-[10px] font-mono text-ink-400 italic text-center py-4">
            No imports yet. Drop a FIT file above to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                Recent activities
              </div>
              <div className="space-y-1">
                {summaryQ.data.recentWorkouts.map((w) => (
                  <div key={w.id} className="text-[11px] font-mono">
                    <span className="text-neon-cyan">{w.name}</span>
                    {w.duration ? (
                      <span className="text-ink-400 ml-2">· {Math.round(w.duration / 60)}m</span>
                    ) : null}
                    <span className="text-ink-500 ml-2">{formatRelative(w.performedAt)}</span>
                  </div>
                ))}
                {summaryQ.data.recentWorkouts.length === 0 && (
                  <div className="text-[10px] font-mono text-ink-500 italic">none</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                Recent sleep
              </div>
              <div className="space-y-1">
                {summaryQ.data.recentSleep.map((s) => (
                  <div key={s.id} className="text-[11px] font-mono">
                    <span className="text-neon-amber">{s.value.toFixed(1)} h</span>
                    <span className="text-ink-500 ml-2">{formatRelative(s.recordedAt)}</span>
                  </div>
                ))}
                {summaryQ.data.recentSleep.length === 0 && (
                  <div className="text-[10px] font-mono text-ink-500 italic">none</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                Recent HRV
              </div>
              <div className="space-y-1">
                {summaryQ.data.recentHrv.map((h) => (
                  <div key={h.id} className="text-[11px] font-mono">
                    <span className="text-neon-cyan">{h.value} ms</span>
                    <span className="text-ink-500 ml-2">{formatRelative(h.recordedAt)}</span>
                  </div>
                ))}
                {summaryQ.data.recentHrv.length === 0 && (
                  <div className="text-[10px] font-mono text-ink-500 italic">none</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Bridge imports — collapsed by default so it doesn't
          dominate the page when there's nothing to show.
          Surfaces only activities ingested via the FitQuestBridge
          APK (importSource = BRIDGE), grouped by local-date in
          the user's timezone. The summary endpoint returns the
          last 14 days; users with longer histories can scan them
          in /activities if they need to. */}
      <Panel
        title="Bridge imports"
        variant="amber"
        className="mt-4"
        action={
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-ink-300">
              {bridgeQ.isLoading ? '…' : `${bridgeQ.data?.totalCount ?? 0} in last ${bridgeQ.data?.days ?? 14}d`}
            </span>
            <button
              onClick={() => setBridgeOpen((o) => !o)}
              className="text-[10px] font-mono uppercase tracking-widest text-ink-300 hover:text-neon-amber border border-ink-500/30 px-2 py-0.5"
              aria-expanded={bridgeOpen}
            >
              {bridgeOpen ? '▾ collapse' : '▸ expand'}
            </button>
          </div>
        }
      >
        {bridgeQ.isLoading ? (
          <div className="text-[10px] font-mono text-ink-300">loading…</div>
        ) : !bridgeQ.data || bridgeQ.data.totalCount === 0 ? (
          <div className="text-[10px] font-mono text-ink-400 italic text-center py-3">
            No bridge uploads yet. Install FitQuestBridge + point it at this
            server; new Gadgetbridge .fit files will show up here.
          </div>
        ) : !bridgeOpen ? (
          <div className="text-[10px] font-mono text-ink-300">
            {bridgeQ.data.groups[0]?.count ?? 0} activities on {bridgeQ.data.groups[0]?.date ?? '—'} · click ▸ expand to see all
          </div>
        ) : (
          <div className="space-y-3">
            {bridgeQ.data.groups.map((g) => (
              <div key={g.date} className="border-l-2 border-neon-amber/30 pl-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] font-display tracking-widest uppercase text-ink-100">
                    {g.date}
                  </div>
                  <div className="text-[10px] font-mono text-ink-400">
                    {g.count} {g.count === 1 ? 'activity' : 'activities'}
                    {g.totalDurationMin > 0 && (
                      <> · {Math.round(g.totalDurationMin)} min total</>
                    )}
                  </div>
                </div>
                <div className="mt-1 space-y-0.5">
                  {g.items.map((it) => (
                    <div key={it.id} className="text-[11px] font-mono flex items-baseline gap-2">
                      <span className="neon-text-amber">{it.name ?? it.notes ?? '(unnamed)'}</span>
                      {it.duration != null && (
                        <span className="text-ink-400">{Math.round(it.duration)}m</span>
                      )}
                      <span className="text-ink-500 ml-auto">{formatRelative(it.performedAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Bridge uploads history — every file the FitQuestBridge
          APK has uploaded, grouped by sourceFilename. Collapsed
          by default so the page stays scannable; clicking a file
          expands to show the individual workouts that came from
          it. Persists across sessions (lives in the DB, not
          localStorage) so the user can come back tomorrow and
          still see what was uploaded last week. */}
      <Panel
        title="Bridge uploads"
        variant="amber"
        className="mt-4"
        action={
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-ink-300">
              {bridgeHistoryQ.isLoading
                ? '…'
                : `${bridgeHistoryQ.data?.totalFiles ?? 0} file${(bridgeHistoryQ.data?.totalFiles ?? 0) === 1 ? '' : 's'} · ${bridgeHistoryQ.data?.totalItems ?? 0} item${(bridgeHistoryQ.data?.totalItems ?? 0) === 1 ? '' : 's'}`}
            </span>
            <button
              onClick={() => setBridgeHistoryOpen((o) => !o)}
              className="text-[10px] font-mono uppercase tracking-widest text-ink-300 hover:text-neon-amber border border-ink-500/30 px-2 py-0.5"
              aria-expanded={bridgeHistoryOpen}
            >
              {bridgeHistoryOpen ? '▾ collapse' : '▸ expand'}
            </button>
          </div>
        }
      >
        {bridgeHistoryQ.isLoading ? (
          <div className="text-[10px] font-mono text-ink-300">loading…</div>
        ) : !bridgeHistoryQ.data || bridgeHistoryQ.data.totalFiles === 0 ? (
          <div className="text-[10px] font-mono text-ink-400 italic text-center py-3">
            No bridge uploads yet. Install FitQuestBridge + point it
            at this server; new .fit files will appear here.
          </div>
        ) : !bridgeHistoryOpen ? (
          <div className="text-[10px] font-mono text-ink-300">
            Click ▸ expand to see the {bridgeHistoryQ.data.totalFiles}{' '}
            file{bridgeHistoryQ.data.totalFiles === 1 ? '' : 's'}
          </div>
        ) : (
          <div className="space-y-2">
            {bridgeHistoryQ.data.files.map((f) => {
              const isOpen = !!bridgeFileOpen[f.filename];
              return (
                <div
                  key={f.filename}
                  className="border border-ink-500/30 rounded-sm"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setBridgeFileOpen((m) => ({ ...m, [f.filename]: !m[f.filename] }))
                    }
                    className="w-full flex items-baseline justify-between gap-2 px-2 py-1.5 hover:bg-neon-amber/5 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-ink-400 text-[10px] font-mono w-3">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <span className="font-mono text-[12px] text-ink-100 truncate" title={f.filename}>
                        {f.filename}
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-ink-400 shrink-0">
                      {f.counts.workout > 0 && <>{f.counts.workout}W </>}
                      {f.counts.measurement > 0 && <>{f.counts.measurement}M </>}
                      {f.counts.daily_log > 0 && <>{f.counts.daily_log}D </>}
                      {' · '}
                      {new Date(f.lastAt).toLocaleDateString()}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-ink-500/20 px-2 py-1.5 space-y-0.5 bg-bg-900/30">
                      {f.items.map((it) => (
                        <div
                          key={`${it.kind}-${it.id}`}
                          className="text-[11px] font-mono flex items-baseline gap-2"
                        >
                          <span className="text-ink-500 shrink-0 w-3">
                            {it.kind === 'workout' ? '⚔' : it.kind === 'measurement' ? '◇' : '☾'}
                          </span>
                          {it.kind === 'workout' ? (
                            <>
                              <span className="text-ink-200 truncate flex-1">
                                {it.name ?? it.notes ?? '(unnamed workout)'}
                              </span>
                              {it.duration != null && (
                                <span className="text-ink-400 shrink-0">
                                  {Math.round(it.duration)}m
                                </span>
                              )}
                              <span className="text-ink-500 shrink-0 ml-auto">
                                {formatRelative(it.performedAt)}
                              </span>
                            </>
                          ) : it.kind === 'measurement' ? (
                            <>
                              <span className="text-ink-200 truncate flex-1">
                                {it.metric} <span className="text-ink-400">=</span> {it.value}{it.unit}
                              </span>
                              <span className="text-ink-500 shrink-0 ml-auto">
                                {formatRelative(it.recordedAt)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-ink-200 truncate flex-1">
                                {it.dailyKey}
                                {it.goldDelta + it.xpDelta > 0 && (
                                  <span className="text-ink-400">
                                    {' '}+{it.goldDelta}g / +{it.xpDelta}xp
                                  </span>
                                )}
                              </span>
                              <span className="text-ink-500 shrink-0 ml-auto">
                                {formatRelative(it.loggedAt)}
                              </span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </Layout>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="border border-ink-500/30 p-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">{label}</div>
      <div className="font-display text-2xl" style={{ color: accent, textShadow: `0 0 6px ${accent}` }}>
        {value}
      </div>
    </div>
  );
}