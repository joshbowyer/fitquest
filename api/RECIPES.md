
---

## 14. Skill tree: loose matching TODO

The skill-tree matching pass is too permissive — it surfaces
skills the user can't really do. Concrete case: a regular
"Push-Ups" set offers to unlock "5 Pike Push-Ups Initiate"
(push-up family has pike push-up as a soft alias). User feedback
called this out as a bug; we agreed to defer to a separate pass
to do it right rather than ship a quick fix.

What to fix when revisited:
- Tighten `NAME_TO_KEYWORDS` aliases so each exercise maps to
  exactly one skill family. Either drop the catch-all "pike pu"
  alias from the push-up family, or restrict the matching so
  the SAME-SET match only considers the keyword that the
  exercise name most strongly matches.
- A "pike push-up" exercise should match pike-push-up skills,
  not all push-up skills. The current "exercise name has 'push'
  in it → matches every push-up family skill" logic is the bug.
- Consider an exercise-name normalization step before keyword
  matching (e.g. trim, lowercase, strip parenthetical like
  "(incline)") so "Push-Ups (Incline)" doesn't fuzzy-match
  every push-up skill.
- The matching pass should rank the candidates by keyword
  specificity (longest matching alias wins) and only return
  the top 1, not all of them.

Out of scope for the prereq unlock work (this is the matching
quality, not the prereq gate — the prereq gate is enforced in
the matching pass and the unlock endpoint, and is correct).
