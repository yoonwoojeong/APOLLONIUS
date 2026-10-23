# Apollonius — Problem Editor Design Spec

**Date:** 2026-10-23
**Status:** Draft for review
**Scope:** Phase 1 of user-created problems: format, validation, editor, local drafts, test-play,
import/export. Phase 2 (accounts, upload, moderation, gallery, ratings on a hosted Supabase
backend) gets its own spec; this spec only prepares for it (§9).

## 1. Intent

Let players author their own compass-and-straightedge problems inside the game, test-play them,
and share them as files — with the same feel and correctness guarantees as the six built-in
levels.

**Success criteria:**

1. A new author can build, test-play and export a working problem on a phone without reading
   instructions.
2. Every problem that passes validation is solvable, robust against coincidental solutions, and
   tappable on a 390 px-wide phone.
3. The built-in Level 1 expressed in the problem format plays identically to the original (same
   goal results and L/E).
4. Nothing changes for the built-in levels, the map, or existing saved progress.

**Decided during brainstorming:** approach "author by doing" (the author builds the target with
the normal tools; their construction becomes the reference solution); authors control title, goal
sentence, per-step hints, explanation and allowed tools; publishing goes through a hosted backend
in phase 2 (GitHub curation was considered and dropped); built-in levels stay as code.

## 2. Problem format

One JSON document per problem (typically 1–3 KB), versioned:

```json
{
  "format": "apollonius-problem",
  "version": 1,
  "title": "Kite Diagonal",
  "goalText": "Construct the line through C perpendicular to AB.",
  "explain": "C is equidistant from A and B, so it lies on their perpendicular bisector.",
  "author": "ada",
  "tools": ["point", "line", "circle"],
  "givens": [
    { "id": "A", "def": { "type": "given-point", "pos": { "x": -1, "y": 0 } } },
    { "id": "B", "def": { "type": "given-point", "pos": { "x": 1, "y": 0 } } },
    { "id": "AB", "def": { "type": "given-line", "a": "A", "b": "B", "extent": "segment" } }
  ],
  "labels": { "A": "A", "B": "B" },
  "solution": [
    {
      "objects": [{ "id": "s1", "def": { "type": "circle", "center": "A", "through": "B" } }],
      "nudge": "Which points are as far from A as B is?"
    }
  ],
  "targets": ["s5"],
  "par": { "L": 3, "E": 3 }
}
```

- `givens` and `solution[].objects` reuse the engine's existing `ObjSpec`/`ObjDef` types
  (`src/construction/types.ts`) unchanged.
- **Givens** may contain `given-point`, `given-line` (`extent` segment / ray / line),
  `given-circle` (centre hidden, as in Level 6), and `circle` whose `center` and `through` are
  given points (a circle with a visible centre). Only `given-point` positions and `given-circle`
  centre/radius are perturbed by the robustness check; the rest follow from them.
- **Solution steps** contain the player-constructible types `free-point`, `on-curve`,
  `intersection`, `line`, `circle`, `perp-bisector`. Each step is one editor move (one game
  command) and carries an optional `nudge`; an empty nudge falls back to
  `"Try the next construction step."`.
- `targets`: ids of solution objects the player must reproduce (1–4).
- `par`: L/E targets for the ★★/★★★ stars (mapped to `Level.targets` by the loader — note
  `Level.targets` means move targets, while the format's `targets` means target objects).
- `title`, `goalText` required; `explain`, `author` optional; `id` is never stored in the file
  (the phase-2 server assigns ids; locally drafts have a `localId`, §6).
- `view` and `sceneDiameter` are not stored; the loader derives them with `frame()`
  (`src/levels/view.ts`) from the givens' points and the targets' points.

## 3. Loader: problem → Level

`src/problems/load.ts` — `toLevel(problem, levelId): Level`.

- `Level.id` widens to `LevelId | ProblemLevelId` with `` type ProblemLevelId = `problem:${string}` ``.
  `Level.number` becomes optional; the top bar shows no number when absent.
- **Goal:** evaluate `givens + solution` against the scene's current given values (so the
  robustness check's perturbations flow through); for every target value, the player's scene must
  contain an equal object (`eqPoint` / `eqCurve` at scene tol), each player object matching at most
  one target. `GoalMatch.ids` = the matching player objects; `gold` = the target values.
- **Reference** = `solution` (steps and nudges), so hints, ghosts and progress matching work as
  for built-in levels.
- **Explain** returns `problem.explain` or the existing fallback sentence.
- `tools` = `problem.tools` (authoritative: an author may allow Perpendicular Bisector regardless
  of the player's unlocks); no `unlocks`, `coach` or `tip`.

## 4. Validation

`src/problems/validate.ts` — `validate(input: unknown): { ok: true; problem: Problem } | { ok: false; errors: ValidationError[] }`,
each error `{ code, path, message }` with a plain-language message. Pure TypeScript, no DOM, no
`eval`. Used by the editor (live checklist), by import, by unit tests, and in phase 2 by the server.

Rules, in order (later rules run only if earlier ones pass):

1. **Shape:** exact top-level keys; `format` and `version` match; strings and numbers have the
   right types; coordinates finite with |x|,|y| ≤ 100.
2. **Limits:** 2–40 givens; 1–60 solution objects; 1–4 targets; title 1–40 chars, goalText 1–120,
   nudge ≤ 120, explain ≤ 200, author ≤ 40, labels 1–3 chars; text is plain (no `<` `>`, no control
   characters), trimmed.
3. **References:** ids unique, matching `[A-Za-z0-9_-]{1,16}`; every reference points at an
   object defined earlier; givens use only the given types of §2, solution steps only the
   constructible types; `targets` reference solution objects.
4. **Tools:** `tools` ⊆ {point, line, circle, perp-bisector}, always including point, line,
   circle; the solution uses only allowed tools.
5. **Geometry:** every object evaluates (no `null`); no target equals a given; the solution
   satisfies the goal; the solution passes `isRobust` (5 perturbations).
6. **Par:** `par.L` ≥ the solution's L and `par.E` ≥ the solution's E (the author's construction
   proves par is reachable).
7. **Tappability:** at a 390×600 phone fit (padding 24), every intersection the solution creates is
   ≥ 40 px from every other point present when it is created. This rule moves from
   `tests/unit/levels/levels.test.ts` into `src/levels/tappability.ts`, shared by the level tests
   and the validator.

Text is always rendered as text (Preact escapes it), never as HTML.

`src/problems/hash.ts` — `problemHash(problem): string`: a stable 53-bit hash (cyrb53) of the
canonical JSON (sorted keys, fixed number formatting). Used for the "tested" mark (§5.4) and, in
phase 2, duplicate detection.

## 5. Editor

### 5.1 Structure

The editor reuses the game's canvas rendering (SceneLayer, viewport, snapping, magnifier,
draw-on animation, tokens) and the game's construction gestures. It adds a Setup interaction for
placing and moving givens. A segmented control at the top switches **Setup · Solve · Details ·
Test**; each segment shows ✓ when its part is complete.

### 5.2 Setup mode — the starting figure

- Tools: **Point** (tap to place; drag an existing given point to move it), **Segment**, **Ray**,
  **Line** (drag point → point; ray from first to second), **Circle** (drag centre → radius point;
  toggle **Hide centre** to make a `given-circle` instead of a centre + through-point circle).
- Snapping, magnifier and the 14/24 px radii behave as in the game. Moving a point live-updates
  everything defined on it, including the solution.
- Points are labelled A, B, C… automatically; tapping a selected point's label edits it.
- **Delete** removes the selected object and everything depending on it (shown highlighted before
  confirming); undoable.
- Setup has its own undo/redo history.

### 5.3 Solve mode — reference solution and targets

- Construction works exactly as in the game (same tools, gestures, candidates, keyboard). Each
  committed command becomes a solution step; undo/redo removes/restores steps.
- **Mark target:** select an object and tap **☆ Target** (toggle); targets render gold.
- **Steps panel** (right side ≥ 768 px, bottom sheet below): one row per step with its
  description (`describe()`), a hint field (≤ 120 chars) and a red flag when the step no longer
  evaluates after a Setup change. Broken steps are never deleted automatically.

### 5.4 Details mode

- Fields: title, goal sentence, explanation, author name — each with a live character counter.
- Allowed tools: Point, Line, Circle (fixed on) and Perpendicular Bisector (toggle).
- Par: defaults to the solution's own L/E. Steppers allow raising it (a more lenient star target)
  but never setting it below the solution, because a par the author has not achieved cannot be
  shown to be reachable.
- **Validation checklist:** every rule of §4 with ✓/✗ and its message; errors link to the mode
  and object they concern (e.g. selecting the offending step).

### 5.5 Test mode

- Plays the problem through the normal game screen (stars, hints, completion card with the
  author's explanation). Available only when validation passes.
- Solving it stores `testedHash = problemHash(problem)` on the draft. Any edit that changes the
  hash clears the tested state. **Export** is always allowed; the draft shows "Tested ✓" only
  when `testedHash` matches.

### 5.6 Layout and accessibility

Phone: mode control at top, palette at bottom, panels as bottom sheets. Wide: panels on the
right. Keyboard construction works as in the game; form fields are labelled; validation results
are announced via a polite live region; reduced motion honoured.

## 6. My problems (local drafts)

- Reached from a **Create** entry on the title screen and the level map.
- Lists drafts newest first with title, status (Draft / Valid / Tested ✓) and best stars.
- Actions: **New**, **Open** (editor), **Play**, **Duplicate**, **Delete** (undo toast),
  **Export** (downloads `<slug>.apollonius.json`), **Import** (file picker; runs `validate`, shows
  errors instead of importing an invalid file). A note says "Uploading to the public gallery is
  coming".
- Storage: separate key `apollonius:problems:v1` →
  `{ version: 1, drafts: [{ localId, createdAt, updatedAt, problem, testedHash?, stars?: [bool,bool,bool] }] }`.
  Drafts may be incomplete (validation is not required to save). Autosave on every change,
  debounced 500 ms. Corrupt or unknown-version data is discarded with a console warning, as for
  progress. Stars for drafts and imported problems live here; `apollonius:v1` progress is
  unchanged.
- Playing a problem uses `store.openCustomLevel(level, { onComplete })`: completion updates the
  draft's stars and never touches `Progress`, unlocks, or the built-in level map.

## 7. Architecture

```
src/
  problems/
    format.ts       Problem types, limits, allowed def types, constants
    validate.ts     validate(input) → ok/errors (pure)
    load.ts         toLevel(problem, levelId) → Level
    hash.ts         problemHash(problem)
    drafts.ts       load/save/upsert/delete drafts (versioned storage)
  levels/
    tappability.ts  shared ≥ 40 px crossing rule (moved from levels.test.ts)
  editor/
    editorStore.ts  editor state: draft, mode, setup history, solve Construction, selection
    setupGestures.ts  pure reducer for Setup placing/moving/deleting givens
    EditorScreen.tsx, ModeBar.tsx, StepsPanel.tsx, DetailsPanel.tsx, ValidationList.tsx
  ui/
    ProblemsScreen.tsx  My problems list
```

Changes to existing code (kept minimal): `Level.id` / `Level.number` types; `TopBar` handles a
missing number; the store gains `openCustomLevel` and new screens `problems` and `editor`; `App`
routes them; title screen and map gain the **Create** entry. Where the canvas is coupled to the
game store, extract the smallest interface needed for the editor to drive it (to be decided in the
implementation plan) rather than duplicating canvas code.

## 8. Testing

- **Unit (Vitest):**
  - `validate`: one valid fixture passes; one failing fixture per rule (unknown type, forward
    reference, degenerate object, unsolvable, coincidence-only solution, target equals a given,
    par below solution, disallowed tool, over-long or markup text, untappable crossing,
    non-finite coordinate).
  - `load`: reference solution reaches the goal and is robust; hints map to the author's steps;
    explain/fallback.
  - **Parity:** a JSON fixture of built-in Level 1 loads to a Level whose goal accepts/rejects
    the same constructions and whose reference meets the same L/E.
  - `hash`: stable across key order; changes on any content change.
  - `drafts`: round-trip; corrupt and unknown-version data discarded with a warning.
  - `setupGestures`: place, move (dependants follow), delete with dependants, label edit.
  - Editor: steps from Solve commands, target toggle, broken-step flag after a Setup move,
    par bounds, tested mark cleared by edits.
- **E2E (Playwright, desktop mouse + phone touch):** create a Level-1-like problem from scratch,
  validate, test-play to completion, export, re-import and play the import; and a problem with an
  untappable crossing shows the error and blocks Test.
- CI: the existing `CI and deploy` workflow runs everything; no new jobs.

## 9. Phase-2 readiness (not built now)

- The file never claims an identity (`id` absent, `author` only a display name).
- `validate` is pure and importable by a Supabase Edge Function (Deno).
- `problemHash` supports duplicate detection.
- The "Uploading is coming" note marks where Upload will go.

## 10. Out of scope

Accounts, upload, moderation, the in-game gallery and ratings (phase 2); converting the built-in
levels to the format; multi-language text; images or free-form drawing in problems; collaborative
editing; editing a problem after upload.
