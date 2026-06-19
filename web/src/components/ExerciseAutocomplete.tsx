import { useState, useEffect, useRef } from 'react';
import { suggestExercises, type ExerciseLoad, ruleForExercise, musclesForExercise } from '@/lib/muscles';
import type { BodyPartId } from './BodyModel';
import { classNames } from '@/lib/format';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onMusclesChange?: (muscles: BodyPartId[]) => void;
  placeholder?: string;
  className?: string;
};

const LOAD_LABEL: Record<ExerciseLoad, { label: string; color: string }> = {
  BODYWEIGHT:           { label: 'bodyweight',         color: '#56e88e' },
  WEIGHTED_BODYWEIGHT:  { label: 'bodyweight + extra', color: '#daa520' },
  FREE_WEIGHT:          { label: 'free weight',        color: '#14d6e8' },
  MACHINE:              { label: 'machine',            color: '#8b9eff' },
  CARDIO:               { label: 'cardio',             color: '#f55cc4' },
  OTHER:                { label: '—',                  color: '#787888' },
};

export function ExerciseAutocomplete({ value, onChange, onMusclesChange, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestExercises(value, 8);
  const exactRule = ruleForExercise(value);

  // When user selects a suggestion (or types an exact match), propagate
  // the muscle mapping back to the parent.
  useEffect(() => {
    if (onMusclesChange) {
      onMusclesChange(musclesForExercise(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function pickSuggestion(name: string) {
    onChange(name);
    setOpen(false);
    setHi(0);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && suggestions[hi]) {
      e.preventDefault();
      pickSuggestion(suggestions[hi].name);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={classNames('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        className="input-neon"
        placeholder={placeholder ?? 'Exercise name (start typing…)'}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />

      {/* Load hint — shows when an exact rule matches */}
      {exactRule && value.length > 2 && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono pointer-events-none flex items-center gap-1">
          <span
            className="px-1.5 py-0.5 border text-[9px] uppercase tracking-widest"
            style={{ color: LOAD_LABEL[exactRule.load].color, borderColor: LOAD_LABEL[exactRule.load].color + '88' }}
          >
            {LOAD_LABEL[exactRule.load].label}
          </span>
        </div>
      )}

      {/* Suggestions dropdown */}
      {open && suggestions.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 z-50 mt-1 border border-neon-cyan/40 bg-bg-900 max-h-64 overflow-y-auto"
          style={{ boxShadow: '0 0 20px rgba(20,214,232,0.15)' }}
        >
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s.name); }}
              onMouseEnter={() => setHi(i)}
              className={classNames(
                'w-full text-left px-2 py-1.5 text-xs font-mono flex items-center gap-2 transition-colors',
                i === hi ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-ink-200 hover:bg-bg-700',
              )}
            >
              <span className="flex-1">{s.name}</span>
              <span
                className="text-[9px] uppercase tracking-widest px-1 py-0.5 border"
                style={{ color: LOAD_LABEL[s.load].color, borderColor: LOAD_LABEL[s.load].color + '66' }}
              >
                {LOAD_LABEL[s.load].label}
              </span>
            </button>
          ))}
          {exactRule && (
            <div className="px-2 py-1 text-[9px] font-mono text-ink-500 border-t border-ink-700/30">
              ↵ to select · ↑↓ to navigate
            </div>
          )}
        </div>
      )}
    </div>
  );
}