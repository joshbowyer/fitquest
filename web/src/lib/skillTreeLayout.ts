// web/src/lib/skillTreeLayout.ts
//
// Pure (no-React) layout math for the SkillTree page.
//
// The page used to render each branch as its own horizontally-scrolling
// row (`BranchColumn` with `overflow-x-auto` per branch). That made
// it impossible to draw prerequisite edges that CROSS branches — the
// two rows had no shared coordinate space. This module replaces that
// with one shared canvas-wide coordinate system:
//
//   ┌─────────────────────────────────────────────────────────┐
//   │                                                         │
//   │   Pull row  ─────●────────●─────●─────────●──────●       │
//   │                  ╲                                       │
//   │                   ╲                                     │
//   │   Holds row ──●────●────●──────────●──────────────●     │
//   │                                                         │
//   └─────────────────────────────────────────────────────────┘
//
// Where every node has one absolute (x, y) on the page, and
// prerequisites are rendered as SVG bezier curves between those
// absolute positions. The depth-based column assignment (vs the
// old per-branch sequential index) ensures cross-branch edges
// never go "backwards" — a skill always lands to the RIGHT of
// every skill it depends on.
//
// This file holds:
//
//   - Skill shape (structural — anything with the required fields
//     matches; the page's local Skill is a superset and is accepted
//     where LayoutSkill[] is requested).
//   - BRANCH_MAX_TIER / BRANCH_ORDER_BY_CLASS / buildBranches —
//     moved verbatim from pages/SkillTree.tsx.
//   - computeLayout — the depth-based column placement with
//     defensive cycle + missing-prereq handling.

// ---- Skill shape --------------------------------------------------------
//
// Structural — keep narrow. The page's local Skill (which has blurb /
// description / test / effects / position) is a superset and is
// accepted where LayoutSkill[] is requested.
export type SkillTier =
  | 'TIER_1'
  | 'TIER_2'
  | 'TIER_3'
  | 'TIER_4'
  | 'TIER_5'
  | 'TIER_6';

export type LayoutSkill = {
  id: string;
  name: string;
  // The Skill model carries an explicit `branch` field set by the
  // seed (one of the canonical labels per class). Skills with a
  // null branch (pre-v1 leftovers) fall into the "Other" row.
  branch: string | null;
  tier: SkillTier;
  prerequisites: string[];
  unlocked: boolean;
};

// ---- Layout constants ---------------------------------------------------
//
// Node geometry matches the existing SkillNode rendering exactly:
//   - button is `w-[110px]`, h fixed via the tier-label + gap + circle
//     + gap + name segments to 100px
//   - the circle is `w-14 h-14` (56px → 28px radius), positioned so
//     its center is at (55, 44) within the button's local coords
//     (tier label 10 + gap 6 + half-circle 28 = 44)
//   - connector lines attach to the LEFT/RIGHT circle edge at y=44
//
// See the comment block on SkillNode in the original SkillTree.tsx
// (around lines 511-527) for the full geometry derivation.
export const NODE_W = 110;
export const NODE_H = 100;
export const ICON_CX = 55;
export const ICON_CY = 44;
export const CIRCLE_R = 28;
export const COL_GAP = 20;
// Vertical gap between branch rows. Big enough that the connector
// beziers between an upper-row Pull node and a lower-row Holds
// node have room to curve down without colliding with neighbor
// nodes in their own rows.
export const ROW_H = 130;
// Top padding above row 0. Without this, the first row's nodes sit
// with y=0 exactly at the canvas's top edge — since the tier label
// (e.g. "T1") renders ABOVE the node's circle within its local
// coordinate box, it ends up flush against (and visually clipped
// by) the viewport's top boundary at every zoom/pan position. This
// small constant lives in the same pre-scale coordinate space as
// everything else, so it stays proportionally consistent as the
// user zooms rather than being a fixed on-screen pixel gap.
export const ROW_PADDING_TOP = 16;
// Reserved width at x=0 of each row for the branch label column.
// The current BranchColumn label is `w-20` (80px); 140 leaves
// breathing room for the longer branch names ("Mace / Indian Club",
// "Ignatian Meditation") and the progress counter below them.
export const LABEL_W = 140;

// ---- Branch ordering + max-tier map -------------------------------------
//
// Both moved verbatim from pages/SkillTree.tsx — they describe the
// DOMAIN (which branches exist per class, and what tier each branch
// tops out at) and must agree with api/src/lib/seedSkills.ts. Keep
// the two files in sync when adding a new branch or changing a cap.
export const BRANCH_MAX_TIER: Record<string, SkillTier> = {
  // JUGGERNAUT
  Squat: 'TIER_5',
  Press: 'TIER_4',
  Deadlift: 'TIER_4',
  Strongman: 'TIER_4',
  Sled: 'TIER_5',
  // PHANTOM (calisthenics)
  Push: 'TIER_6',
  Pull: 'TIER_5',
  Holds: 'TIER_5',
  Rings: 'TIER_5',
  Handstand: 'TIER_5',
  Planche: 'TIER_6',
  Legs: 'TIER_5',
  // SCOUT
  Run: 'TIER_6',
  Ruck: 'TIER_5',
  Triathlon: 'TIER_5',
  // BERSERKER
  Kettlebell: 'TIER_4',
  Capacity: 'TIER_4',
  Boxing: 'TIER_4',
  'Mace / Indian Club': 'TIER_4',
  Sandbag: 'TIER_4',
  // TRACER
  Sprint: 'TIER_5',
  Plyo: 'TIER_5',
  Parkour: 'TIER_5',
  Agility: 'TIER_4',
  // ORACLE
  Mobility: 'TIER_5',
  Breath: 'TIER_4',
  Balance: 'TIER_5',
  'Ignatian Meditation': 'TIER_4',
  Yoga: 'TIER_4',
};
export function maxTierFor(branchName: string): SkillTier {
  return BRANCH_MAX_TIER[branchName] ?? 'TIER_3';
}

// Canonical branch order per class. Used to sort rows in the correct
// top-to-bottom order. Any new branch label returned from the server
// that isn't in this list gets appended after the known ones.
export const BRANCH_ORDER_BY_CLASS: Record<string, string[]> = {
  JUGGERNAUT: ['Squat', 'Press', 'Deadlift', 'Overhead Press', 'Strongman', 'Sled'],
  PHANTOM: ['Push', 'Pull', 'Holds', 'Rings', 'Handstand', 'Planche', 'Legs'],
  SCOUT: ['Run', 'Ruck', 'Triathlon'],
  BERSERKER: ['Sled', 'Kettlebell', 'Boxing', 'Capacity', 'Mace / Indian Club', 'Sandbag', 'Medicine Ball'],
  TRACER: ['Sprint', 'Plyo', 'Parkour', 'Agility', 'Throws'],
  ORACLE: ['Mobility', 'Breath', 'Balance', 'Ignatian Meditation', 'Yoga', 'Pilates'],
};

// ---- Branch grouping ----------------------------------------------------
//
// One row per branch. The order is: known branch labels for the
// class in their canonical order, then any unknowns alphabetically,
// then "Other" last.
export type Branch<T extends LayoutSkill = LayoutSkill> = {
  branchName: string;
  tier: SkillTier;
  skills: T[];
};

export function buildBranches<T extends LayoutSkill>(items: T[], className: string): Branch<T>[] {
  const order = BRANCH_ORDER_BY_CLASS[className] ?? [];
  // Group by skill.branch.
  const groups = new Map<string, T[]>();
  for (const s of items) {
    const branch = s.branch ?? 'Other';
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch)!.push(s);
  }
  // Sort branches: known order first, then any unknowns alphabetically,
  // "Other" always last.
  const sortKey = (name: string): [number, string] => {
    if (name === 'Other') return [2, ''];
    const idx = order.indexOf(name);
    if (idx === -1) return [1, name];
    return [0, order[idx]];
  };
  const sortedBranches = Array.from(groups.entries())
    .map(([branchName, skills]) => ({ branchName, skills }))
    .sort((a, b) => {
      const [oa, sa] = sortKey(a.branchName);
      const [ob, sb] = sortKey(b.branchName);
      if (oa !== ob) return oa - ob;
      return sa.localeCompare(sb);
    });
  return sortedBranches.map((b) => ({ ...b, tier: maxTierFor(b.branchName) }));
}

// ---- Layout algorithm ---------------------------------------------------

export type LayoutNode<T extends LayoutSkill = LayoutSkill> = {
  skill: T;
  x: number;
  y: number;
  col: number;
  row: number;
  // True when this skill's tier matches the branch's max tier — i.e.
  // the hardest skill of its branch. Equivalent to the old
  // `isLast && s.tier === branch.tier` check; we drop the `isLast`
  // because the layout is now a DAG (no single linear chain) and the
  // tier check is the semantically meaningful invariant.
  isGodTier: boolean;
};

export type LayoutEdge = {
  from: string; // source skill name
  to: string; // target skill name
  fromNode: { x: number; y: number };
  toNode: { x: number; y: number };
};

export type Layout<T extends LayoutSkill = LayoutSkill> = {
  nodes: LayoutNode<T>[];
  edges: LayoutEdge[];
  width: number;
  height: number;
};

export function computeLayout<T extends LayoutSkill>(items: T[], className: string): Layout<T> {
  if (items.length === 0) {
    return { nodes: [], edges: [], width: LABEL_W, height: 0 };
  }

  const byName = new Map(items.map((s) => [s.name, s]));

  // Group into branches for row assignment.
  const branches = buildBranches(items, className);

  // Which row each skill lives in — needed so the collision-bump
  // step below can look up "this skill's branch's used-columns set"
  // while resolving in dependency order (not branch-by-branch).
  const rowOfSkill = new Map<string, number>();
  for (let row = 0; row < branches.length; row++) {
    for (const s of branches[row].skills) rowOfSkill.set(s.name, row);
  }

  // Source-order index — used as a stable tie-breaker for the
  // initial resolution order. The `items` array is the natural
  // source order from the API; we snapshot each skill's position so
  // ties are stable across re-renders.
  const sourceIndex = new Map<string, number>();
  items.forEach((s, i) => sourceIndex.set(s.name, i));

  // Per-skill final column, resolved via DFS over the prereq DAG in
  // a SINGLE pass that combines topological depth with the
  // within-branch collision bump — unlike a two-pass approach
  // (compute raw depth everywhere, THEN bump within each branch
  // afterward), which has a real bug: a downstream skill computing
  // its own column from a prereq's PRE-bump depth can land in the
  // SAME OR AN EARLIER column than that (post-bump) prereq, since
  // the bump could have pushed the prereq further right than its
  // raw depth. That produces backward-flowing or near-vertical
  // connector edges that visually contradict the dependency
  // direction — exactly the "curvy lines don't go where they
  // logically should" bug this single-pass version fixes.
  //
  // Fix: resolve each skill's column ONLY from its prereqs' ACTUAL
  // FINAL (already-bumped) columns, memoized as we go, so by the
  // time a dependent computes its own base column, every one of its
  // prereqs — same-branch or cross-branch — already has its real,
  // final rendered column. The invariant "every skill renders
  // strictly to the right of everything it depends on" now holds
  // even after bumping, because bumping only ever pushes a column
  // FURTHER right, never left of the already-correct base.
  //
  // Cycle defense: `visiting` set, same semantics as before — a
  // skill can't be its own (in-progress) ancestor; hitting one
  // falls back to column 0 for that node so recursion unwinds
  // instead of looping forever.
  // Missing-prereq defense: unresolvable prereq names are skipped.
  const finalCol = new Map<string, number>();
  const usedColsByRow = new Map<number, Set<number>>();
  for (let row = 0; row < branches.length; row++) usedColsByRow.set(row, new Set());
  const visiting = new Set<string>();

  function resolveCol(skill: LayoutSkill): number {
    if (finalCol.has(skill.name)) return finalCol.get(skill.name)!;
    if (visiting.has(skill.name)) return 0; // cycle guard
    visiting.add(skill.name);
    let baseCol = 0;
    if (skill.prerequisites && skill.prerequisites.length > 0) {
      let maxPrereqCol = -1;
      for (const prereqName of skill.prerequisites) {
        const prereqSkill = byName.get(prereqName);
        if (!prereqSkill) continue; // missing-prereq defense
        maxPrereqCol = Math.max(maxPrereqCol, resolveCol(prereqSkill));
      }
      baseCol = maxPrereqCol + 1;
    }
    visiting.delete(skill.name);

    // Within-branch collision bump, applied HERE (at resolution
    // time, in true dependency order) rather than in a separate
    // later branch-by-branch pass — this is what guarantees any
    // skill depending on this one sees the correctly-bumped final
    // column, not a stale pre-bump base column.
    const row = rowOfSkill.get(skill.name) ?? 0;
    const usedCols = usedColsByRow.get(row)!;
    let col = baseCol;
    while (usedCols.has(col)) col++;
    usedCols.add(col);
    finalCol.set(skill.name, col);
    return col;
  }

  // Resolve every skill's column. Recursion handles dependency
  // ordering regardless of iteration order; the source-order sort
  // here only affects the tie-break among mutually-independent
  // skills that would otherwise resolve in an arbitrary order.
  const sortedItems = [...items].sort(
    (a, b) => (sourceIndex.get(a.name) ?? 0) - (sourceIndex.get(b.name) ?? 0),
  );
  for (const skill of sortedItems) resolveCol(skill);

  // Build the node array with absolute coordinates.
  const nodes: LayoutNode<T>[] = [];
  let maxCol = 0;
  let maxRow = -1;
  for (let row = 0; row < branches.length; row++) {
    const branch = branches[row];
    const y = row * ROW_H + ROW_PADDING_TOP;
    if (branch.skills.length > 0) maxRow = row;
    for (const skill of branch.skills) {
      const col = finalCol.get(skill.name)!;
      if (col > maxCol) maxCol = col;
      nodes.push({
        skill,
        x: LABEL_W + col * (NODE_W + COL_GAP),
        y,
        col,
        row,
        // God-tier = skill's tier matches the branch's max tier.
        // Equivalent to the old `isLast && s.tier === branch.tier`
        // check; `isLast` is dropped because the DAG layout has no
        // single linear chain to be "last" in.
        isGodTier: skill.tier === branch.tier,
      });
    }
  }

  // Build edges from prereqs, with circle-edge endpoint coords so
  // the SVG connectors attach cleanly to the left/right of each
  // node's circle (matching the original BranchColumn connector's
  // y=44 attachment point).
  const nodeByName = new Map<string, LayoutNode>();
  for (const n of nodes) nodeByName.set(n.skill.name, n);

  const edges: LayoutEdge[] = [];
  for (const node of nodes) {
    if (!node.skill.prerequisites || node.skill.prerequisites.length === 0) continue;
    for (const prereqName of node.skill.prerequisites) {
      const prereqNode = nodeByName.get(prereqName);
      if (!prereqNode) continue; // defensive: missing prereq
      edges.push({
        from: prereqName,
        to: node.skill.name,
        fromNode: {
          // Right edge of the source circle.
          x: prereqNode.x + ICON_CX + CIRCLE_R,
          y: prereqNode.y + ICON_CY,
        },
        toNode: {
          // Left edge of the target circle.
          x: node.x + ICON_CX - CIRCLE_R,
          y: node.y + ICON_CY,
        },
      });
    }
  }

  // Total canvas dimensions. Width covers all columns up to maxCol;
  // height covers all rows. Add a small right/bottom padding so the
  // last node's right/bottom edge isn't flush with the canvas edge
  // (otherwise the zoomed viewport clips the rightmost god-tier node).
  const width = LABEL_W + (maxCol + 1) * NODE_W + maxCol * COL_GAP + COL_GAP;
  const height = (maxRow + 1) * ROW_H + COL_GAP + ROW_PADDING_TOP;

  return { nodes, edges, width, height };
}
