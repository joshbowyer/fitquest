import { useAuth } from '@/lib/auth';
import { Panel } from './Panel';
import { Link } from 'react-router-dom';
import {
  getFrameSize,
  getFrameArchetype,
  getBuildCategory,
  getHeightCategory,
  ARCHETYPE_META,
  ARCHETYPE_MATRIX,
  ARCHETYPE_ORDER,
  type BuildCategory,
  type FrameArchetype,
  type HeightCategory,
  type FrameSize,
} from '@/lib/frame';
import { convertForDisplay, type UnitSystem } from '@/lib/units';
import { classNames } from '@/lib/format';

function formatHeight(cm: number, system: UnitSystem): string {
  if (system === 'IMPERIAL') {
    const totalIn = cm / 2.54;
    const ft = Math.floor(totalIn / 12);
    const inch = Math.round(totalIn - ft * 12);
    return `${ft}'${inch}"`;
  }
  return `${Math.round(cm)} cm`;
}

function formatCirc(cm: number, system: UnitSystem): string {
  const d = convertForDisplay(cm, 'cm', system);
  return `${d.value.toFixed(d.value < 10 ? 2 : 1)} ${d.unit}`;
}

const BUILD_LABELS: Record<BuildCategory, string> = {
  LEAN: 'Lean',
  BALANCED: 'Balanced',
  SOLID: 'Solid',
};

const HEIGHT_LABELS: Record<HeightCategory, string> = {
  SHORT: 'Short',
  MEDIUM: 'Medium',
  TALL: 'Tall',
};

export function FramePanel() {
  const { user } = useAuth();
  if (!user) return null;
  const system: UnitSystem = user.units ?? 'METRIC';
  const { heightCm, wristCm, ankleCm, bodyFatPct, weightKg } = user;
  const frameSize: FrameSize = getFrameSize(wristCm, ankleCm);
  const archetype: FrameArchetype | null = getFrameArchetype(heightCm, weightKg, bodyFatPct);
  const height: HeightCategory = getHeightCategory(heightCm);
  const build: BuildCategory = getBuildCategory(weightKg, heightCm, bodyFatPct);
  const missing: string[] = [];
  if (!heightCm) missing.push('height');
  if (!wristCm) missing.push('wrist');
  if (!ankleCm) missing.push('ankle');

  return (
    <Panel variant="cyan" title="Frame">
      <div className="space-y-3">
        {archetype ? (
          <>
            <div className="text-center">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Archetype</div>
              <div
                className="font-display text-4xl tracking-[0.2em] text-ink-50 mt-0.5"
                style={{ textShadow: '0 0 12px rgba(245,245,250,0.5)' }}
              >
                {ARCHETYPE_META[archetype].emoji} {ARCHETYPE_META[archetype].label}
              </div>
              <div className="text-[10px] text-ink-300 font-mono mt-1 italic">
                {ARCHETYPE_META[archetype].tagline}
              </div>
            </div>

            {/* 3x3 somatotype grid */}
            <div className="border-t border-ink-500/30 pt-3">
              <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-1 text-[9px] font-mono">
                <div></div>
                <div className="text-center text-ink-300 uppercase tracking-widest pb-1">{HEIGHT_LABELS.SHORT}</div>
                <div className="text-center text-ink-300 uppercase tracking-widest pb-1">{HEIGHT_LABELS.MEDIUM}</div>
                <div className="text-center text-ink-300 uppercase tracking-widest pb-1">{HEIGHT_LABELS.TALL}</div>

                <div className="text-right pr-2 text-ink-300 uppercase tracking-widest self-center">{BUILD_LABELS.LEAN}</div>
                {(['SHORT', 'MEDIUM', 'TALL'] as const).map((h) => {
                  const a = ARCHETYPE_MATRIX.LEAN[h];
                  const meta = ARCHETYPE_META[a];
                  const isUser = archetype === a;
                  return (
                    <div
                      key={h}
                      className={classNames(
                        'h-10 border flex items-center justify-center font-display tracking-wider text-[10px]',
                        isUser
                          ? `border-neon-${meta.color}/80 bg-neon-${meta.color}/15 neon-text-${meta.color}`
                          : 'border-ink-500/30 text-ink-300'
                      )}
                      style={isUser ? { textShadow: '0 0 6px currentColor' } : undefined}
                    >
                      {meta.label.slice(0, 3).toUpperCase()}
                    </div>
                  );
                })}

                <div className="text-right pr-2 text-ink-300 uppercase tracking-widest self-center">{BUILD_LABELS.BALANCED}</div>
                {(['SHORT', 'MEDIUM', 'TALL'] as const).map((h) => {
                  const a = ARCHETYPE_MATRIX.BALANCED[h];
                  const meta = ARCHETYPE_META[a];
                  const isUser = archetype === a;
                  return (
                    <div
                      key={h}
                      className={classNames(
                        'h-10 border flex items-center justify-center font-display tracking-wider text-[10px]',
                        isUser
                          ? `border-neon-${meta.color}/80 bg-neon-${meta.color}/15 neon-text-${meta.color}`
                          : 'border-ink-500/30 text-ink-300'
                      )}
                      style={isUser ? { textShadow: '0 0 6px currentColor' } : undefined}
                    >
                      {meta.label.slice(0, 3).toUpperCase()}
                    </div>
                  );
                })}

                <div className="text-right pr-2 text-ink-300 uppercase tracking-widest self-center">{BUILD_LABELS.SOLID}</div>
                {(['SHORT', 'MEDIUM', 'TALL'] as const).map((h) => {
                  const a = ARCHETYPE_MATRIX.SOLID[h];
                  const meta = ARCHETYPE_META[a];
                  const isUser = archetype === a;
                  return (
                    <div
                      key={h}
                      className={classNames(
                        'h-10 border flex items-center justify-center font-display tracking-wider text-[10px]',
                        isUser
                          ? `border-neon-${meta.color}/80 bg-neon-${meta.color}/15 neon-text-${meta.color}`
                          : 'border-ink-500/30 text-ink-300'
                      )}
                      style={isUser ? { textShadow: '0 0 6px currentColor' } : undefined}
                    >
                      {meta.label.slice(0, 3).toUpperCase()}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 text-center text-xs font-mono border-t border-ink-500/30 pt-2">
              <div>
                <div className="text-ink-300 text-[9px] uppercase tracking-widest">Height</div>
                <div className="neon-text-cyan">{heightCm ? formatHeight(heightCm, system) : '—'}</div>
              </div>
              <div>
                <div className="text-ink-300 text-[9px] uppercase tracking-widest">Build</div>
                <div className="neon-text-cyan">{BUILD_LABELS[build]}</div>
              </div>
            </div>

            {ARCHETYPE_ORDER
              .filter((a) => a !== archetype)
              .slice(0, 3)
              .map((a) => {
                const meta = ARCHETYPE_META[a];
                return (
                  <div key={a} className="text-[10px] font-mono text-ink-300 flex items-center gap-1">
                    <span className="text-ink-400">·</span>
                    <span className="text-ink-200">{meta.label}</span>
                    <span className="text-ink-400">— {meta.description.slice(0, 60)}…</span>
                  </div>
                );
              })}
          </>
        ) : (
          <div className="text-center py-3">
            <div className="text-xs text-neon-amber font-mono mb-2 animate-pulse">! FRAME INCOMPLETE</div>
            <div className="text-[10px] text-ink-300 font-mono mb-3">
              Missing: {missing.join(', ')}.<br />
              Somatotype (9-class grid) needs all three.
            </div>
            <Link to="/profile" className="btn-ghost inline-block">
              → COMPLETE FRAME
            </Link>
          </div>
        )}
        <Link
          to="/profile"
          className="text-[10px] font-display tracking-widest neon-text-cyan hover:underline block text-center pt-1"
        >
          → EDIT FRAME
        </Link>
      </div>
    </Panel>
  );
}