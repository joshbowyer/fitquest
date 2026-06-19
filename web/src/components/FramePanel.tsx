import { useAuth } from '@/lib/auth';
import { Panel } from './Panel';
import { Link } from 'react-router-dom';
import { getFrameSize, frameDescription } from '@/lib/frame';
import { convertForDisplay, type UnitSystem } from '@/lib/units';

const FRAME_COLOR: Record<string, 'magenta' | 'cyan' | 'amber'> = {
  SMALL: 'magenta',
  MEDIUM: 'cyan',
  LARGE: 'amber',
};

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

export function FramePanel() {
  const { user } = useAuth();
  if (!user) return null;
  const system: UnitSystem = user.units ?? 'METRIC';
  const { heightCm, wristCm, ankleCm, bodyFatPct } = user;
  const hasCore = heightCm != null && wristCm != null && ankleCm != null;
  const frameSize = getFrameSize(wristCm, ankleCm);
  const color = FRAME_COLOR[frameSize] || 'cyan';
  const missing: string[] = [];
  if (!heightCm) missing.push('height');
  if (!wristCm) missing.push('wrist');
  if (!ankleCm) missing.push('ankle');

  return (
    <Panel variant="cyan" title="Frame">
      <div className="space-y-3">
        {hasCore ? (
          <>
            <div className="text-center">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Frame size</div>
              <div
                className={`font-display text-4xl tracking-[0.3em] neon-text-${color} mt-0.5`}
                style={{ textShadow: '0 0 12px currentColor' }}
              >
                {frameSize}
              </div>
              <div className="text-[10px] text-ink-300 font-mono mt-1 italic">
                {frameDescription(frameSize)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center text-xs font-mono border-t border-ink-500/30 pt-2">
              <div>
                <div className="text-ink-300 text-[9px] uppercase tracking-widest">Height</div>
                <div className={`neon-text-${color}`}>{formatHeight(heightCm!, system)}</div>
              </div>
              <div>
                <div className="text-ink-300 text-[9px] uppercase tracking-widest">Wrist</div>
                <div className={`neon-text-${color}`}>{formatCirc(wristCm!, system)}</div>
              </div>
              <div>
                <div className="text-ink-300 text-[9px] uppercase tracking-widest">Ankle</div>
                <div className={`neon-text-${color}`}>{formatCirc(ankleCm!, system)}</div>
              </div>
            </div>
            {bodyFatPct != null && (
              <div className="text-center text-[10px] font-mono text-ink-300 border-t border-ink-500/30 pt-2">
                Body Fat: <span className="neon-text-cyan">{bodyFatPct.toFixed(1)}%</span>
              </div>
            )}
            <Link
              to="/profile"
              className="text-[10px] font-display tracking-widest neon-text-cyan hover:underline block text-center pt-1"
            >
              → EDIT FRAME
            </Link>
          </>
        ) : (
          <div className="text-center py-3">
            <div className="text-xs text-neon-amber font-mono mb-2 animate-pulse">! FRAME INCOMPLETE</div>
            <div className="text-[10px] text-ink-300 font-mono mb-3">
              Missing: {missing.join(', ')}.<br />
              Genetic max formulas need all three.
            </div>
            <Link to="/profile" className="btn-ghost inline-block">
              → COMPLETE FRAME
            </Link>
          </div>
        )}
      </div>
    </Panel>
  );
}
