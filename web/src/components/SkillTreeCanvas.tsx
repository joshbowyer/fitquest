// web/src/components/SkillTreeCanvas.tsx
//
// Shared-coordinate-space renderer for the SkillTree page. Replaces
// the old per-branch horizontal-scroll layout (BranchColumn +
// overflow-x-auto per row) with a single absolutely-positioned
// canvas where cross-branch prerequisite edges are drawn cleanly
// as SVG bezier curves, plus an isolated zoom control (only on this
// page — nothing else in the app exposes zoom).
//
// Layout math + branch ordering live in @/lib/skillTreeLayout.
// This component is responsible for:
//   - zoom state + scroll-stable zoom transitions
//   - the absolutely-positioned SkillNode + branch-label markup
//   - the SVG connector layer with 3-state coloring
//     (unlocked → lime, prereq-met-but-locked → dim cyan,
//      else → ink)

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { classNames } from '@/lib/format';
import { NeonButton } from '@/components/NeonButton';
import { branchIcon, calitreeIconFor, skillCalitreeIconFor, SKILL_ICONS } from '@/lib/skillIcons';
import { CLASS_META } from '@/lib/types';
import {
  computeLayout,
  LABEL_W,
  NODE_H,
  ROW_H,
  ROW_PADDING_TOP,
  type LayoutSkill,
} from '@/lib/skillTreeLayout';

// Tailwind text-neon-* class for the user's class accent. Used by
// the calitree PNG icons (via mask-image + background-color:
// currentColor) to color each silhouette per the user's class.
// PHANTOM → lime, JUGGERNAUT → red, BERSERKER → magenta, etc.
// Mirrors the same color scheme as primaryColorForClass() in
// web/src/lib/quest.ts but returns a Tailwind class directly.
function classColorForClass(c: string | null): string {
  if (!c) return 'text-neon-lime';
  const meta = CLASS_META[c];
  if (!meta) return 'text-neon-lime';
  switch (meta.color) {
    case 'red':        return 'text-neon-red';
    case 'magenta':    return 'text-neon-magenta';
    case 'lime':       return 'text-neon-lime';
    case 'orange':     return 'text-neon-orange';
    case 'goldenrod':  return 'text-neon-goldenrod';
    case 'periwinkle': return 'text-neon-periwinkle';
    default:           return 'text-neon-lime';
  }
}

// Discrete zoom steps (matches the original task spec: 0.5, 0.65,
// 0.8, 1). Buttons step through this list.
const ZOOM_STEPS = [0.25, 0.4, 0.6, 0.8, 1];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const DRAG_THRESHOLD = 5; // px before treating move as pan vs tap/click
// Softens raw pinch-distance-ratio -> zoom mapping so a fast pinch
// motion doesn't blow through the whole zoom range in one frame.
// 1.0 = no damping (old behavior); lower = finer control, needs
// more physical finger travel per unit of zoom change.
const PINCH_SENSITIVITY = 0.45;

// Connector colors. Hex values match the inline hex codes already
// used elsewhere in the SkillNode drop-shadow rules (see the
// '5s Front Lever' / '5s Back Lever' branch-label drop-shadow on
// the original BranchColumn: `drop-shadow(0 0 4px #56e88e)`).
//
// Why hex and not CSS vars: inline SVG `stroke=` attributes do not
// reliably resolve `rgb(var(--neon-lime))` strings in some render
// paths. The hardcoded values match the dark theme; the connector
// stays readable in light mode at the dimmer opacities.
const COLOR_UNLOCKED = '#56e88e'; // neon-lime dark
const COLOR_PREREQ_MET = '#14d6e8'; // neon-cyan dark
const COLOR_LOCKED = '#8a8c98'; // ink-500 dark

export function SkillTreeCanvas<T extends LayoutSkill>({
  items,
  className,
  onSkillClick,
  unlockedNames,
}: {
  items: T[];
  className: string;
  onSkillClick: (skill: T) => void;
  /**
   * Set of unlocked skill names. Used to color the SVG
   * connectors (lime when both endpoints unlocked, dim cyan
   * when prereq met but target still locked, ink otherwise).
   */
  unlockedNames: Set<string>;
}) {
  // Default zoom: 50% on mobile for PHANTOM specifically (its tree
  // is the densest right now — 158 skills across 7 branches — so a
  // full-scale initial view is mostly off-screen on a phone). Other
  // classes haven't been reviewed for this yet, so they keep the
  // prior 100% default. `768` matches this codebase's existing
  // Tailwind `md:` breakpoint convention used elsewhere (Layout.tsx).
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const isMobile = window.innerWidth < 768;
    return isMobile && className === 'PHANTOM' ? 0.5 : 1;
  });
  const { nodes, edges, width, height } = useMemo(
    () => computeLayout(items, className),
    [items, className],
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Pending scroll correction for the next render. Set when the
  // user clicks a zoom button, consumed by the useLayoutEffect
  // below to apply after the new transform renders.
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  // Gesture state (pointer events only — no external libs).
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    isDragging: boolean;
  } | null>(null);
  const lastPinchDistRef = useRef(0);
  const lastPinchZoomRef = useRef(1);

  function stepZoom(direction: 1 | -1) {
    const cur = zoom;
    if (direction > 0) {
      const next = ZOOM_STEPS.find((z) => z > cur + 1e-6);
      if (next == null) return;
      applyZoom(next);
    } else {
      const reversed = [...ZOOM_STEPS].reverse();
      const next = reversed.find((z) => z < cur - 1e-6);
      if (next == null) return;
      applyZoom(next);
    }
  }

  function applyZoom(newZoom: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    const el = viewportRef.current;
    if (!el) {
      setZoom(clamped);
      return;
    }
    // Keep the current view CENTER stable when zoom changes:
    //   newScroll = (oldScroll + viewportSize/2) * (newZoom/oldZoom)
    //               - viewportSize/2
    // If we're zooming OUT, this means scroll position moves
    // TOWARD the viewport center (so the visible area expands
    // outward from where the user was looking). If we're
    // zooming IN, scroll moves AWAY from the viewport center
    // (so the center stays where it was).
    const ratio = clamped / zoom;
    const cx = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
    const cy = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    pendingScrollRef.current = { left: cx, top: cy };
    setZoom(clamped);
  }

  // Apply the pending scroll AFTER React commits the new zoom but
  // BEFORE the browser paints. useLayoutEffect runs synchronously
  // after DOM mutations, so the user doesn't see the viewport
  // jump from the old scroll to the corrected one — both
  // happen in the same frame.
  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    const el = viewportRef.current;
    if (el) {
      el.scrollLeft = pendingScrollRef.current.left;
      el.scrollTop = pendingScrollRef.current.top;
    }
    pendingScrollRef.current = null;
  }, [zoom]);

  // Pointer / wheel gesture handlers for pinch-zoom, drag-pan, ctrl+wheel.
  // Attached only to this viewport (isolated to SkillTree page).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain scroll = native pan; ctrl = zoom
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left + el.scrollLeft;
      const cy = e.clientY - rect.top + el.scrollTop;
      const delta = -e.deltaY * 0.0018; // smooth sensitivity
      const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 + delta)));
      const ratio = targetZoom / zoom;
      const newLeft = cx * ratio - (e.clientX - rect.left);
      const newTop = cy * ratio - (e.clientY - rect.top);
      pendingScrollRef.current = { left: newLeft, top: newTop };
      setZoom(targetZoom);
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      // Only exclude button-taps when this is the FIRST touch of a
      // gesture — a second (or third) finger landing on one of the
      // densely-packed skill circles is overwhelmingly a pinch, not
      // an attempt to tap that specific node. Excluding it here
      // used to silently drop that finger from pointersRef entirely,
      // so pointersRef.size never reached 2 and pinch-zoom could
      // never trigger whenever either finger happened to start over
      // a node — which, given how densely nodes are packed, was
      // most of the time. Only the very first pointer of a gesture
      // gets the tap/click carve-out; anything after that is always
      // tracked.
      if (pointersRef.current.size === 0 && target.closest('button')) return;
      // No setPointerCapture — WebView often drops the 2nd pointer when capture is active.
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Single-pointer drag-pan only (mouse, or a lone finger).
      // Pinch is handled EXCLUSIVELY by the parallel Touch Events
      // block below now — see the comment there for why. This used
      // to also have a 2-pointer pinch branch here, but since a
      // physical two-finger touch dispatches BOTH Pointer Events
      // AND Touch Events on Android WebView, having pinch logic in
      // both places meant every pinch frame ran through two
      // independent handlers computing zoom from the SAME shared
      // lastPinchDistRef/lastPinchZoomRef refs, each calling
      // setZoom() — redundant at best, and a real source of
      // jittery/oversensitive zoom at worst (each handler's `zoom`
      // closure could be one render behind the other's, so their
      // ratio math didn't always agree). One authority, one set of
      // refs actually driving zoom, is simpler and correct.
      if (pointersRef.current.size === 1) {
        dragStateRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startScrollLeft: el.scrollLeft,
          startScrollTop: el.scrollTop,
          isDragging: false,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 1 && dragStateRef.current) {
        const ds = dragStateRef.current;
        const dx = e.clientX - ds.startX;
        const dy = e.clientY - ds.startY;
        if (!ds.isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          ds.isDragging = true;
        }
        if (ds.isDragging) {
          el.scrollLeft = ds.startScrollLeft - dx;
          el.scrollTop = ds.startScrollTop - dy;
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size === 0) {
        dragStateRef.current = null;
      }
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    // Touch Events (parallel to Pointer) for reliable 2-finger pinch in
    // Android Capacitor WebView. Pointer Events multi-touch delivery is
    // inconsistent in embedded WebViews; classic Touch Events with
    // e.touches are the most universally supported path.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        lastPinchDistRef.current = dist;
        lastPinchZoomRef.current = zoom;
        // Prevent native page zoom
        e.preventDefault();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastPinchDistRef.current > 0) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        const rawScale = dist / lastPinchDistRef.current;
        // Damping: applying the raw finger-distance ratio 1:1 to
        // zoom meant a small, fast pinch motion (very common —
        // fingers naturally move quickly at gesture start) blew
        // straight through the entire zoom range in one frame, so
        // the user couldn't settle on any particular level.
        // PINCH_SENSITIVITY < 1 softens the effective rate: only
        // ~45% of the raw distance-ratio's deviation from 1.0
        // actually gets applied, so the same finger movement now
        // needs roughly 2x the physical pinch distance to reach
        // the same zoom change — giving much finer, stoppable
        // control without capping the eventual reachable range
        // (MIN_ZOOM/MAX_ZOOM clamp still applies as before).
        const scale = 1 + (rawScale - 1) * PINCH_SENSITIVITY;
        const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, lastPinchZoomRef.current * scale));

        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const rect = el.getBoundingClientRect();
        const cx = midX - rect.left + el.scrollLeft;
        const cy = midY - rect.top + el.scrollTop;
        const ratio = targetZoom / zoom;
        const newLeft = cx * ratio - (midX - rect.left);
        const newTop = cy * ratio - (midY - rect.top);
        pendingScrollRef.current = { left: newLeft, top: newTop };
        setZoom(targetZoom);
        lastPinchZoomRef.current = targetZoom;
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        lastPinchDistRef.current = 0;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoom]);

  // Pre-compute the unlocked lookup so the edge renderer doesn't
  // re-do .has() lookups on every render.
  const edgeColor = useMemo(() => {
    const map = new Map<string, { unlocked: boolean; prereqMet: boolean }>();
    for (const node of nodes) {
      map.set(node.skill.name, {
        unlocked: node.skill.unlocked,
        prereqMet: unlockedNames.has(node.skill.name),
      });
    }
    return map;
  }, [nodes, unlockedNames]);

  // Auto-center the canvas on first load (when scrollLeft/Top
  // are 0 and width exceeds the viewport). Keeps the initial
  // view focused on the start of the tree — the deepest nodes
  // are off to the right and the user reaches them by scrolling.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // No-op if the user has already started interacting.
    if (el.scrollLeft !== 0 || el.scrollTop !== 0) return;
    // Best-effort: nothing to do if the content fits.
    if (el.scrollWidth <= el.clientWidth) return;
    // Place col 0 at the left edge — i.e. leave x=0 at the natural
    // top-left. The user can scroll right to reach higher tiers.
  }, [width, height]);

  // Group nodes by row for the branch-label pass.
  const rowNodes = useMemo(() => {
    const groups = new Map<number, typeof nodes>();
    for (const n of nodes) {
      if (!groups.has(n.row)) groups.set(n.row, []);
      groups.get(n.row)!.push(n);
    }
    return groups;
  }, [nodes]);

  // Per-row branch metadata. The first node's branch name identifies
  // the row (all nodes on the same row share the same branch).
  const rowMeta = useMemo(() => {
    const meta = new Map<number, { branchName: string; unlocked: number; total: number }>();
    for (const [row, ns] of rowNodes.entries()) {
      const first = ns[0];
      const branchName = first.skill.branch ?? 'Other';
      const unlocked = ns.filter((n) => n.skill.unlocked).length;
      meta.set(row, { branchName, unlocked, total: ns.length });
    }
    return meta;
  }, [rowNodes]);

  return (
    <div>
      {/* Zoom controls — isolated to this page (no other route
          exposes zoom). Discrete step buttons + a 100% reset +
          a readout. */}
      <div className="flex items-center gap-2 mb-2">
        <NeonButton
          variant="cyan"
          size="sm"
          onClick={() => stepZoom(-1)}
          disabled={zoom <= MIN_ZOOM + 1e-6}
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </NeonButton>
        <NeonButton
          variant="cyan"
          size="sm"
          onClick={() => stepZoom(1)}
          disabled={zoom >= MAX_ZOOM - 1e-6}
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </NeonButton>
        <NeonButton
          variant="cyan"
          size="sm"
          onClick={() => applyZoom(1)}
          disabled={Math.abs(zoom - 1) < 1e-6}
          title="Reset to 100%"
        >
          100%
        </NeonButton>
        <span className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
          {Math.round(zoom * 100)}%
        </span>
        <span className="text-[10px] font-mono text-ink-400 ml-2">
          scroll inside for god-tier →
        </span>
      </div>

      {/* Viewport — overflow-auto gives both axes so users on
          narrow viewports can pan to off-screen right-tier nodes.
          h-[70vh] keeps the panel at a fixed viewing size regardless
          of zoom level (so zooming out reveals empty space around a
          smaller canvas instead of shrinking the panel itself). */}
      <div
        ref={viewportRef}
        // touch-none: all panning and zooming here is handled
        // manually via pointer/wheel events (scrollLeft/scrollTop
        // assignment), not native touch-scroll. Without this, the
        // browser's own native pinch-to-zoom-the-page gesture can
        // intercept/compete with a two-finger touch before our JS
        // pointermove handler sees clean, uninterrupted deltas —
        // on some mobile browsers this silently wins over our
        // handler and the page zooms instead of (or in addition
        // to) our canvas transform.
        // h-[70vh] (a FIXED height), not max-h-[70vh] (a ceiling only).
        // max-height alone lets this block-level div shrink to fit its
        // content when the zoomed-out canvas becomes smaller than 70vh
        // — the viewport itself visibly shrank along with the content
        // instead of staying put with empty space around a smaller
        // canvas. h- forces a real, constant viewing area regardless
        // of zoom level; the canvas inside shrinks/grows freely within
        // it via the scale() transform, exactly as intended.
        className="overflow-auto h-[70vh] relative bg-bg-900/40 border border-ink-700/30 rounded touch-none"
      >
        {/* Outer wrapper sized to the scaled canvas so the scroll
            bars reflect the actual visible area. transform-origin:
            0 0 + scale(N) is applied to the inner wrapper. */}
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div
            style={{
              width,
              height,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'relative',
            }}
          >
            {/* SVG connector layer. Absolutely-positioned at 0,0
                to cover the full canvas; the bezier endpoints come
                from computeLayout and attach to the left/right of
                each node's circle (matching the original
                BranchColumn connector's y=44 attachment point). */}
            <svg
              width={width}
              height={height}
              className="absolute inset-0 pointer-events-none"
            >
              {edges.map((edge) => {
                const fromState = edgeColor.get(edge.from);
                const toState = edgeColor.get(edge.to);
                const fromUnlocked = !!fromState?.unlocked;
                const toUnlocked = !!toState?.unlocked;
                const toPrereqMet = !!toState?.prereqMet;
                let stroke: string;
                let opacity: number;
                if (fromUnlocked && toUnlocked) {
                  // Full unlock chain: both endpoints lit.
                  stroke = COLOR_UNLOCKED;
                  opacity = 0.85;
                } else if (toPrereqMet) {
                  // Prereq satisfied but target still locked —
                  // a "ready to unlock" hint in cyan.
                  stroke = COLOR_PREREQ_MET;
                  opacity = 0.6;
                } else {
                  // Upstream not unlocked yet: dim ink.
                  stroke = COLOR_LOCKED;
                  opacity = 0.35;
                }
                const dx = edge.toNode.x - edge.fromNode.x;
                // Horizontal-flowing cubic bezier. Control points
                // are at the horizontal midpoint of source/target
                // so the curve flows smoothly left-to-right even
                // when source and target are on different rows
                // (the y change is absorbed by the curve's
                // natural S-shape).
                const path = `M ${edge.fromNode.x} ${edge.fromNode.y} C ${edge.fromNode.x + dx / 2} ${edge.fromNode.y}, ${edge.toNode.x - dx / 2} ${edge.toNode.y}, ${edge.toNode.x} ${edge.toNode.y}`;
                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={path}
                    stroke={stroke}
                    strokeWidth={2}
                    fill="none"
                    opacity={opacity}
                  />
                );
              })}
            </svg>

            {/* Branch labels — one per row, positioned at x=0
                of each row. Reuses the original BranchColumn
                label markup (icon + name + progress count)
                so the visual is preserved. */}
            {Array.from(rowMeta.entries()).map(([row, meta]) => (
              <BranchLabel
                key={meta.branchName}
                branchName={meta.branchName}
                className={className}
                unlocked={meta.unlocked}
                total={meta.total}
                y={row * ROW_H + ROW_PADDING_TOP}
              />
            ))}

            {/* Absolutely-positioned SkillNode buttons. */}
            {nodes.map((node) => (
              <div
                key={node.skill.id}
                style={{ position: 'absolute', left: node.x, top: node.y }}
              >
                <SkillNode
                  skill={node.skill}
                  className={className}
                  onClick={() => onSkillClick(node.skill)}
                  isUnlocked={node.skill.unlocked}
                  isGodTier={node.isGodTier}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Branch label --------------------------------------------------------
//
// The left-column per-row header. Visual: icon + branch name + progress
// counter. Preserved verbatim from the original BranchColumn label
// markup (icon → name → "X/Y") for visual continuity.

function BranchLabel({
  branchName,
  className,
  unlocked,
  total,
  y,
}: {
  branchName: string;
  className: string;
  unlocked: number;
  total: number;
  y: number;
}) {
  const icon = branchIcon(branchName, className);
  const calitreeFile = calitreeIconFor(branchName);
  const allDone = unlocked === total;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: y,
        // Width matches the LABEL_W reserved column. Vertical
        // centering mirrors the original BranchColumn's
        // min-h-[64px] label.
        width: LABEL_W,
        minHeight: NODE_H,
      }}
      className="flex flex-col items-center gap-1 py-2 pr-2 border-r border-ink-700/30 justify-center"
    >
      <div
        className={classNames(
          // text-[28px] so the hand-coded SVG label icons (1em)
          // match the 28px (w-7) calitree PNG label icons.
          'text-[28px] leading-none',
          allDone ? 'text-neon-lime' : classColorForClass(className),
          'transition-colors duration-200',
        )}
      >
        {calitreeFile ? (
          <i
            aria-hidden
            className="block w-7 h-7 select-none"
            style={{
              WebkitMaskImage: `url(/icons/calitree/${calitreeFile}.png)`,
              maskImage: `url(/icons/calitree/${calitreeFile}.png)`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              backgroundColor: 'currentColor',
              filter: allDone
                ? 'drop-shadow(0 0 4px #56e88e)'
                : 'drop-shadow(0 0 3px currentColor)',
            }}
          />
        ) : (
          <span className="block">{icon}</span>
        )}
      </div>
      <div className="text-[9px] font-mono uppercase tracking-widest text-neon-cyan/80 truncate w-full text-center">
        {branchName}
      </div>
      <div
        className={classNames(
          'text-[9px] font-mono',
          allDone ? 'text-neon-lime' : 'text-ink-400',
        )}
      >
        {unlocked}/{total}
      </div>
    </div>
  );
}

// ---- SkillNode -----------------------------------------------------------
//
// The visual circle + tier label + skill name. Moved here verbatim
// from the original pages/SkillTree.tsx so the absolute-positioning
// change is purely a layout refactor (the node's internal markup
// and styling are unchanged — same icon resolution, same focus
// rings, same unlock-state colors, same aria attributes).

function SkillNode({
  skill,
  className,
  onClick,
  isUnlocked,
  isGodTier,
}: {
  skill: LayoutSkill;
  className: string;
  onClick: () => void;
  isUnlocked: boolean;
  isGodTier: boolean;
}) {
  // Per-skill icons override the branch icon for specific skills
  // whose silhouette is more recognizable than the branch label
  // (e.g. '3 Muscle-Ups' gets its own muscle-up icon instead of
  // the generic 'Pull' pull-ups.png). Fall through to branchIcon
  // when the skill name isn't in the SKILL_ICONS map.
  const icon = SKILL_ICONS[skill.name] ?? branchIcon(skill.branch, className);
  // Calitree.app-style icon for branches that have a direct
  // calisthenics analog. Per-skill lookup wins over the branch
  // lookup (so e.g. 'L-Sit' gets the l-sit.png, not the
  // generic plank.png). null → fall through to the hand-coded
  // SVG above (covers heavy barbell / sled / boxing / mace / etc.
  // where calitree.app doesn't have a node).
  const calitreeFile = skillCalitreeIconFor(skill.name) ?? calitreeIconFor(skill.branch);
  const tierShort = skill.tier.replace('TIER_', 'T');
  return (
    <button
      onClick={onClick}
      aria-label={`${skill.name} (${skill.tier}${isGodTier ? ' god-tier' : ''})`}
      // w-[110px] forces every SkillNode to the same width so the
      // connector-to-connector spacing is identical across all
      // branches (short vs long skill names). Without this, the
      // button width tracks the skill name's intrinsic width, and
      // branches end up looking stretched or compressed relative
      // to each other.
      // Every vertical segment of this button has a FIXED height:
      // tier label h-2.5 (10px) + gap 6px + circle h-14 (56px) +
      // gap 6px + name h-[22px] = 100px, for every node. Combined
      // with `items-start` on the chain wrapper, the circle top is
      // at a constant y=16 in every node, so all icons share the
      // same Y. (The old min-h-[92px] + items-center approach
      // failed because 2-line names made those buttons ~100px tall
      // while 1-line ones were floored at 92px; centering the
      // shorter buttons inside the stretched row pushed their
      // circles ~4px lower than their 2-line-name neighbors.)
      className={classNames(
        'group flex flex-col items-center gap-1.5 outline-none w-[110px] shrink-0',
        'focus-visible:ring-2 focus-visible:ring-neon-cyan/60 rounded-lg',
      )}
    >
      {/* Tier label — fixed 10px height so the icon's vertical
          position below it is constant across all buttons. */}
      <div
        className={classNames(
          'text-[8px] font-display tracking-widest uppercase h-2.5 leading-none',
          isGodTier
            ? 'text-neon-amber'
            : isUnlocked
              ? 'text-neon-lime'
              : 'text-ink-400',
        )}
      >
        {tierShort}
      </div>
      {/* The circle — calitree-style flow-chart node. Renders a
          calitree PNG (with synthwave CSS filter) when one exists,
          otherwise the hand-coded SVG via `icon`. */}
      <div
        className={classNames(
          'relative w-14 h-14 rounded-full border-2 flex items-center justify-center',
          // text-[28px]: the hand-coded SVGs render at 1em, so this
          // makes them exactly 28px — the same size as the w-7 h-7
          // calitree PNG masks. (text-2xl was 24px, which left the
          // SVG icons visibly smaller than the PNG ones.)
          'text-[28px] transition-all duration-200',
          isGodTier
            ? 'border-neon-amber bg-neon-amber/10 shadow-neon-amber'
            : isUnlocked
              ? 'border-neon-lime bg-neon-lime/10 shadow-neon-lime'
              : 'border-ink-500/40 bg-bg-800/60 group-hover:border-neon-cyan/60 group-hover:bg-neon-cyan/5',
        )}
      >
        {calitreeFile ? (
          // PNG from /icons/calitree/ used as a CSS mask. The PNG
          // itself is just a flat silhouette on transparent
          // background; `background-color: currentColor` paints
          // it the parent's text color, and the drop-shadow filter
          // adds the neon glow. This way the same PNG can be
          // neon-lime for PHANTOM, neon-magenta for BERSERKER,
          // neon-amber for god-tier, dim for locked — all without
          // regenerating the PNG. See scripts/gen-planche-nano.py
          // for how the stroke-free PNG is generated.
            <i
              aria-hidden
              className={classNames(
                // w-7 h-7 = 28px. Same size the hand-coded SVG
                // ends up at via the `text-[28px]` → `1em` flow on
                // the circle above. Both icon kinds are flex-
                // centered in the same 56px circle, so their
                // centers — and sizes — now match exactly.
                'block w-7 h-7 select-none transition-all duration-200',
                isGodTier
                ? 'text-neon-amber'
                : isUnlocked
                  ? classColorForClass(className)
                  : 'text-ink-500',
              isUnlocked ? 'opacity-100' : 'opacity-40',
            )}
            style={{
              WebkitMaskImage: `url(/icons/calitree/${calitreeFile}.png)`,
              maskImage: `url(/icons/calitree/${calitreeFile}.png)`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              backgroundColor: 'currentColor',
              filter: isGodTier
                ? 'drop-shadow(0 0 3px #ffaa3a)'
                : isUnlocked
                  ? 'drop-shadow(0 0 2.5px currentColor)'
                  : 'none',
            }}
          />
        ) : (
          <span
            className={classNames(
              'leading-none select-none',
              isUnlocked ? '' : 'opacity-40 grayscale',
            )}
          >
            {icon}
          </span>
        )}
        {/* Lock badge for locked nodes */}
        {!isUnlocked && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-bg-900 border border-ink-500/60 flex items-center justify-center text-[8px] leading-none">
            🔒
          </span>
        )}
        {/* Check mark for unlocked nodes */}
        {isUnlocked && !isGodTier && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-neon-lime text-bg-900 flex items-center justify-center text-[8px] font-bold leading-none">
            ✓
          </span>
        )}
        {/* Star for god-tier */}
        {isGodTier && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neon-amber text-bg-900 flex items-center justify-center text-[8px] leading-none">
            ★
          </span>
        )}
      </div>
      {/* Skill name — fixed two-line box (h-[22px] = 2 × 11px
          lines) so the button height is identical whether the
          name wraps to 1 or 2 lines. This is what keeps every
          button exactly 100px tall (see the className comment on
          the button above). */}
      <div
        className={classNames(
          'text-[9px] font-display tracking-wide text-center max-w-[110px]',
          'leading-[11px] h-[22px] line-clamp-2',
          isUnlocked ? 'text-neon-lime' : 'text-ink-200',
        )}
        title={skill.name}
      >
        {skill.name}
      </div>
    </button>
  );
}

// Suppress unused-imports warnings for symbols that are imported
// for completeness but not directly referenced at module scope.
// (All symbols are consumed by SkillNode / BranchLabel / the SVG
// edge layer via the layout math in @/lib/skillTreeLayout.)
