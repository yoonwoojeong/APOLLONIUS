# Problem Editor (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players author compass-and-straightedge problems in-game (Setup · Solve · Details ·
Test), keep them as local drafts, test-play them and import/export them as validated JSON files.

**Architecture:** A pure `src/problems/` core (format types, validator, hash, loader that turns a
problem into a normal `Level`, draft storage) feeds an editor. Solve and Test reuse the game's
store, `Canvas` and `GameScreen` through a new `openCustomLevel`; Setup gets a small canvas of its
own built from the existing `SceneLayer`, `useViewport`, snapping and `Magnifier`. Built-in
levels and `apollonius:v1` progress are untouched.

**Tech Stack:** Vite 8, TypeScript 5.9 strict, Preact 10 + @preact/signals, Vitest 5 (jsdom for
UI), Playwright 1.56 (preinstalled Chromium — never `playwright install`), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-23-problem-editor-design.md` — read it before any task;
§ references below point into it.

## Global Constraints

- Format: `"format": "apollonius-problem"`, `"version": 1`; files never contain `id` (§2).
- Given types: `given-point`, `given-line` (`extent` segment/ray/line), `given-circle`, `circle`
  whose `center`/`through` are given points. Solution types: `free-point`, `on-curve`,
  `intersection`, `line`, `circle`, `perp-bisector` (§2).
- Limits (§4): 2–40 givens; 1–60 solution objects; 1–4 targets; title 1–40 chars, goalText
  1–120, nudge ≤ 120, explain ≤ 200, author ≤ 40, labels 1–3 chars; ids `[A-Za-z0-9_-]{1,16}`;
  coordinates finite with |x|,|y| ≤ 100; text must not contain `<`, `>` or control characters.
- Tools always include point, line, circle; perp-bisector optional (§4).
- Par: `par.L ≥ solution L` and `par.E ≥ solution E`; default equals the solution (§4, §5.4).
- Empty nudge fallback copy: `Try the next construction step.` (§2).
- Tappability: at `fit(view, 390, 600, 24)` every solution intersection ≥ 40 px from every other
  point present when it is created (§4).
- Draft storage key `apollonius:problems:v1`, shape `{ version: 1, drafts: Draft[] }`; autosave
  debounced 500 ms; corrupt/unknown data discarded with `console.warn` (§6).
- Problem level ids are `problem:<localId>`; playing a problem never writes `apollonius:v1`
  progress, unlocks or built-in stars (§3, §6).
- Export filename `<slug>.apollonius.json`; import shows validation errors instead of importing
  (§6). Copy: `Uploading to the public gallery is coming` (§6).
- Text is rendered as text, never HTML; no `eval`/`Function` anywhere in `src/problems/`.
- Every UI addition honours tokens, light/dark, reduced motion, 44 px targets and the 768 px
  breakpoint of the game.
- Commits end with the session's attribution trailers; never push (the controller pushes).

## Review Focus

1. **Import of a hostile or huge file** (multi-MB, binary, deeply nested JSON) must be refused fast
   with a clear message and never freeze the page → Task 11: 200 KB size cap before `JSON.parse`,
   test with a 300 KB file and a non-JSON file.
2. **Storage full or unavailable while autosaving** must keep editing working in memory and show a
   one-line non-blocking warning `Couldn't save drafts on this device.` → Task 5 test with a
   throwing `setItem`.
3. **Deleting or moving a given the solution depends on** must flag the affected steps as broken,
   never silently drop them → Task 7 test (delete A → steps using A broken, kept).
4. **Leaving the editor right after an edit** (Map/Back, tab hidden, reload) must not lose the last
   change → Task 7: autosave flushes on `exit()` and on `visibilitychange`→hidden; test.
5. **Playing a custom problem must not touch built-in progress or unlocks**, even when it allows
   Perpendicular Bisector before Level 3 is solved → Task 4 store test.

---

### Task 1: Problem format, canonical hash and shared tappability rule

**Files:**

- Create: `src/problems/format.ts`, `src/problems/hash.ts`, `src/levels/tappability.ts`
- Modify: `tests/unit/levels/levels.test.ts` (use the extracted rule)
- Test: `tests/unit/problems/hash.test.ts`, `tests/unit/levels/tappability.test.ts`

**Interfaces:**

- Produces (`format.ts`):
  - `interface ProblemStep { objects: ObjSpec[]; nudge: string }`
  - `interface Problem { format: 'apollonius-problem'; version: 1; title: string; goalText: string; explain?: string; author?: string; tools: ToolId[]; givens: ObjSpec[]; labels: Record<ObjId, string>; solution: ProblemStep[]; targets: ObjId[]; par: { L: number; E: number } }`
  - `GIVEN_TYPES`, `SOLUTION_TYPES` (readonly arrays of `ObjDef['type']`), `LIMITS` (all numbers
    from Global Constraints), `NUDGE_FALLBACK = 'Try the next construction step.'`
  - `problemPoints(p: Problem): Vec[]` — evaluated positions of given points, given-circle
    centres and target points (for framing).
- Produces (`hash.ts`): `canonicalJson(value: unknown): string` (sorted keys, numbers via
  `Number(n.toPrecision(12))`), `problemHash(p: Problem): string` (cyrb53 of `canonicalJson`, as
  14-char base-36).
- Produces (`tappability.ts`): `interface CrossingIssue { stepIndex: number; id: ObjId; nearId: ObjId; px: number }`;
  `tooCloseCrossings(givens: ObjSpec[], steps: ObjSpec[][], view: Rect, minPx = 40): CrossingIssue[]`
  using `fit(view, 390, 600, 24)`.

- [ ] **Step 1: Failing tests.** `problemHash` equal for two objects differing only in key order;
      different after changing one coordinate by 1e-6 or one nudge character. `canonicalJson({b:1,a:[2,{d:0,c:1}]})`
      → `'{"a":[2,{"c":1,"d":0}],"b":1}'`. `tooCloseCrossings` returns `[]` for every built-in level's
      reference (iterate `LEVELS`) and one issue for a constructed case (A(0,0), B(0.05,0) style
      fixture where a crossing lands 6 px from a point).
- [ ] **Step 2: Run** `pnpm test tests/unit/problems tests/unit/levels` → FAIL (modules missing).
- [ ] **Step 3: Implement**; move the existing 40 px check in `levels.test.ts` to call
      `tooCloseCrossings` (same assertions).
- [ ] **Step 4: Run** → PASS; `pnpm typecheck && pnpm lint` → 0.
- [ ] **Step 5: Commit** `feat(problems): format types, canonical hash, shared tappability rule`.

---

### Task 2: Validator

**Files:**

- Create: `src/problems/goal.ts`, `src/problems/validate.ts`, fixtures
  `tests/fixtures/problems/valid-perp-bisector.json` (a level-2-like problem),
  `tests/fixtures/problems/level1.json` (built-in Level 1 in the format)
- Test: `tests/unit/problems/validate.test.ts`

**Interfaces:**

- Consumes: Task 1; `evaluate` (construction); `isRobust` (`src/reasoning/robustness.ts`), called
  with a minimal `Level`-shaped object built from `targetGoal` (Task 3 reuses `targetGoal`).
- Produces:
  - `interface ValidationError { code: ValidationCode; path: string; message: string }`
  - `type ValidationCode = 'shape' | 'limit' | 'text' | 'id' | 'reference' | 'type' | 'tool' | 'degenerate' | 'target-given' | 'unsolved' | 'not-robust' | 'par' | 'untappable'`
  - `validate(input: unknown): { ok: true; problem: Problem } | { ok: false; errors: ValidationError[] }`
  - `solutionMoves(p: Problem): { L: number; E: number }` (per move-cost rules: line/circle 1L1E,
    perp-bisector 1L3E, points free)
  - `targetGoal(givens: ObjSpec[], solution: ObjSpec[], targets: ObjId[], sceneDiameter: number): (s: Scene) => GoalMatch | null`
    in `src/problems/goal.ts` — evaluates givens+solution against the scene's current given
    values (overrides from `s`), then requires a distinct equal player object per target
    (`eqPoint`/`eqCurve` at `s.tol`); `gold` = target values.

Rules run in §4 order; a phase's errors stop later phases. Messages are plain language and name
the object label or step number, e.g. `Step 4: the crossing is too close to point B to tap on a
phone — move B or pick another construction.`

- [ ] **Step 1: Failing tests** (each asserts `ok:false` and the listed `code`; the valid
      fixtures assert `ok:true`):

```ts
test('valid fixture passes', …); test('level1 fixture passes', …);
test('non-object input → shape', () => expect(codes(validate('x'))).toContain('shape'));
test('unknown top-level key → shape', …); test('version 2 → shape', …);
test('41 givens → limit', …); test('title of 41 chars → limit', …);
test('title containing "<b>" → text', …); test('id "A B" → id', …);
test('solution references id defined later → reference', …);
test('given of type "circle" whose centre is not a given point → type', …);
test('solution using "given-point" → type', …);
test('perp-bisector step while tools lacks it → tool', …);
test('tools missing "circle" → tool', …);
test('line through A and A → degenerate', …);
test('target is a given → target-given', …);
test('two targets with identical geometry (a point and its duplicate intersection) → unsolved', …);
test('target is a free point placed exactly at the midpoint of AB → not-robust', …);
test('par.L below solution → par', …);
test('crossing 6 px from a point → untappable', …);
test('coordinate 1e9 → limit', …); test('NaN coordinate → shape', …);
test('solutionMoves(valid fixture) = {L:3,E:3}', …);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `goal.ts` then `validate.ts` (hand-written
      structural checks; no schema library). **Step 4: Run** → PASS; typecheck, lint → 0.
- [ ] **Step 5: Commit** `feat(problems): validator and target-equality goal`.

---

### Task 3: Loader — problem → Level, with parity

**Files:**

- Create: `src/problems/load.ts`
- Modify: `src/levels/types.ts` (`Level.id: LevelId | ProblemLevelId`, `number?: number`,
  export `ProblemLevelId`), `src/ui/TopBar.tsx` (omit the number element when absent)
- Test: `tests/unit/problems/load.test.ts`, `tests/unit/ui/TopBar.test.tsx` (extend)

**Interfaces:**

- Consumes: Task 1 types, Task 2 `targetGoal`, `frame` (`src/levels/view.ts`), `FALLBACK`
  explanation from `src/levels/explain.ts`.
- Produces: `` type ProblemLevelId = `problem:${string}` ``;
  `toLevel(problem: Problem, id: ProblemLevelId): Level` — `title`, `goalText`, `givens`,
  `labels`, `view`/`sceneDiameter` from `frame(problemPoints(p))`, `targets` = `par`,
  `tools` = `problem.tools`, `goal` = `targetGoal(...)`, `reference` = steps with nudges (empty →
  `NUDGE_FALLBACK`), `explain` = `() => problem.explain || FALLBACK`; no number/unlocks/coach/tip.

- [ ] **Step 1: Failing tests.**
  - Reference of the valid fixture reaches the goal and `isRobust` is true.
  - **Parity:** for `level1.json` vs `levelById('equilateral')`: the reference constructions of
    both satisfy both goals; a "wrong" construction (isosceles C) fails both; the reference's
    `moves()` equals `{L:4,E:4}` for both.
  - `nextHint` on an empty scene returns the first step's nudge (or the fallback when empty).
  - TopBar renders no number element for a level without `number`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; full `pnpm test`,
      typecheck, lint → 0 (the `Level.id` widening must not break existing code).
- [ ] **Step 5: Commit** `feat(problems): load problems as levels`.

---

### Task 4: Store and game screen support for custom levels

**Files:**

- Modify: `src/construction/construction.ts` (add `steps()`), `src/state/store.ts`,
  `src/canvas/Canvas.tsx`, `src/ui/GameScreen.tsx`, `src/ui/CompletionCard.tsx` (if needed)
- Test: `tests/unit/state/store.test.ts`, `tests/unit/construction/construction.test.ts`,
  `tests/unit/ui/GameScreen.test.tsx`

**Interfaces:**

- Produces:
  - `Construction.steps(): ObjSpec[][]` — objects of each active `add` command after the last
    reset, in order (one inner array per command).
  - Store: `currentLevel: ReadonlySignal<Level>` (replaces `levelById(levelId.value)` everywhere;
    keep `levelId` as a computed of `currentLevel.value.id`); screen union gains `'problems' |
'editor'`;
    `openCustomLevel(level: Level, opts: { onComplete?: (stars: Stars) => void; onExit: () => void; sandbox?: boolean }): void`
    — opens `screen 'level'`; for a custom level `availableTools()` = `level.tools` (no unlock
    filter), completion calls `onComplete` and never writes progress/unlocks; `sandbox: true`
    disables completion entirely (used by the editor's Solve mode).
    `exitCustomLevel(): void` calls the stored `onExit`.
    `isCustom: ReadonlySignal<boolean>`.
- Game screen for a custom level: TopBar Map button reads `Back` and calls `exitCustomLevel`;
  CompletionCard shows `Back` (primary) and `Replay`, no `Next`/`Map`; tips/coach never show.

- [ ] **Step 1: Failing tests.**
  - `steps()` returns `[[circle],[circle],[intersection],[line],[line]]` after the Level-1
    reference, `[]` after reset, and respects undo.
  - Opening a custom level that allows perp-bisector with fresh progress → `availableTools()`
    includes it; solving it calls `onComplete([true,…])` and leaves `progress.value` deep-equal to
    before and storage untouched (Review Focus 5).
  - `sandbox: true`: a goal-satisfying construction sets no completion.
  - `openLevel('equilateral')` after a custom level restores normal behaviour.
  - GameScreen with a custom level shows `Back`, completion card has no `Next`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full `pnpm test`, typecheck,
      lint → 0; existing E2E untouched (run `pnpm e2e --project=desktop tests/e2e/play.spec.ts`).
- [ ] **Step 5: Commit** `feat: custom levels in the store and game screen`.

---

### Task 5: Draft storage

**Files:**

- Create: `src/problems/drafts.ts`
- Test: `tests/unit/problems/drafts.test.ts`

**Interfaces:**

- Produces:
  - `interface Draft { localId: string; createdAt: number; updatedAt: number; problem: DraftProblem; testedHash?: string; stars?: [boolean, boolean, boolean] }`
    where `DraftProblem` = `Problem` with every field optional except `format`/`version`
    (incomplete drafts are allowed).
  - `DRAFTS_KEY = 'apollonius:problems:v1'`
  - `loadDrafts(storage: Pick<Storage,'getItem'> | null): Draft[]`;
    `saveDrafts(storage: Pick<Storage,'setItem'> | null, drafts: Draft[]): boolean` (false on
    failure, never throws); `newDraft(now: number, rand: () => number): Draft` (blank problem,
    tools point/line/circle, `localId` 10 base-36 chars); `slugify(title: string): string`
    (`[a-z0-9-]`, ≤ 40, fallback `problem`).

- [ ] **Step 1: Failing tests:** round-trip; corrupt JSON → `[]` + `console.warn` (spied);
      version 2 → `[]` + warn; throwing `setItem` → `saveDrafts` returns `false` (Review Focus 2);
      `slugify('Kite Diagonal!')` → `'kite-diagonal'`, `slugify('***')` → `'problem'`.
- [ ] **Step 2–4:** RED, implement, GREEN; typecheck, lint.
- [ ] **Step 5: Commit** `feat(problems): local draft storage`.

---

### Task 6: Setup gestures (pure)

**Files:**

- Create: `src/editor/setupGestures.ts`
- Test: `tests/unit/editor/setupGestures.test.ts`

**Interfaces:**

- Consumes: `SnapTarget` (`src/canvas/snap.ts`), `TAP_SLOP_PX` (`src/canvas/gestures.ts`).
- Produces:
  - `type SetupTool = 'point' | 'segment' | 'ray' | 'line' | 'circle'`
  - `interface SetupModel { givens: ObjSpec[]; labels: Record<ObjId, string> }`
  - `type SetupEdit = { type: 'add'; specs: ObjSpec[]; labels: Record<ObjId,string> } | { type: 'move'; id: ObjId; pos: Vec } | { type: 'move-circle'; id: ObjId; c?: Vec; r?: number } | { type: 'delete'; ids: ObjId[] } | { type: 'relabel'; id: ObjId; label: string }`
  - `setupReducer(state: SetupGestureState, ev: GestureEvent, ctx: { tool: SetupTool; hideCentre: boolean; model: SetupModel; allocId: () => ObjId; nextLabel: () => string }): { state: SetupGestureState; edits: SetupEdit[]; preview: { kind: 'segment'|'ray'|'line'|'circle'; from: Vec; to: Vec } | null }`
  - `applyEdit(model: SetupModel, edit: SetupEdit): SetupModel`; `dependants(model: SetupModel, id: ObjId): ObjId[]`.
- Rules: point tool — tap empty → `given-point` with next label (A, B, …, skipping used);
  press on an existing given point and drag beyond slop → `move` edits during the drag (live);
  segment/ray/line — drag point→point (snapping to existing given points, creating points at
  empty ends) → `given-line` with the extent; circle — drag centre→radius: visible → centre point,
  through point and a `circle` def; `hideCentre` → `given-circle {c, r}`; a hidden circle is moved
  by dragging its centre handle (`move-circle c`) and resized by dragging its rim
  (`move-circle r`). Delete removes the object and `dependants`.

- [ ] **Step 1: Failing tests:** tap places A then B; dragging A moves it and the reducer emits
      `move` with the new world pos; segment drag between A and B makes `given-line{extent:'segment'}`;
      segment drag from empty to empty creates two points + the segment; hidden circle → one
      `given-circle` and no point; `dependants(A)` includes the segment AB and a circle centred at A;
      delete A removes them; relabel rejects labels outside 1–3 chars `[A-Za-z0-9′']`.
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `feat(editor): setup gesture reducer`.

---

### Task 7: Editor model

**Files:**

- Create: `src/editor/editorStore.ts`
- Test: `tests/unit/editor/editorStore.test.ts`

**Interfaces:**

- Consumes: Tasks 1–6; the game `Store` (`openCustomLevel`, `construction().steps()`, `revision`).
- Produces `createEditor(game: Store, storage: Storage | null, draft: Draft, now = Date.now)`
  returning signals and actions:
  - `mode: Signal<'setup'|'solve'|'details'|'test'>`; `setup: Signal<SetupModel>`;
    `solution: Signal<ProblemStep[]>`; `broken: ReadonlySignal<number | null>` (index of the first
    step that no longer evaluates, else null); `targets: Signal<ObjId[]>`;
    `details: Signal<{ title; goalText; explain; author; perpBisector: boolean; par: {L;E} | null }>`
    (`par: null` = use the solution's moves); `validation: ReadonlySignal<ReturnType<typeof validate>>`;
    `problem: ReadonlySignal<DraftProblem>`; `tested: ReadonlySignal<boolean>`;
    `modeDone: ReadonlySignal<Record<'setup'|'solve'|'details'|'test', boolean>>`;
    `saveFailed: Signal<boolean>`.
  - Setup: `applySetup(edit: SetupEdit)`, `undoSetup()`, `redoSetup()`.
  - Solve: `enterSolve()` — opens `game.openCustomLevel(sandboxLevel, { sandbox: true, onExit })`
    where `sandboxLevel` = current givens, all four tools, `goal: () => null`, and replays the valid
    solution prefix by `game.apply` per step; while in Solve, every `game.revision` change syncs
    `solution` from `construction().steps()` (keeping each step's nudge by step index when its
    objects are unchanged, else empty) followed by the retained broken tail.
    `setNudge(i, text)`, `toggleTarget(id)`, `removeFrom(i)` (drops steps ≥ i).
  - Details: `setDetails(patch)`; par clamps to ≥ the solution's moves.
  - Test: `startTest()` — only when validation ok: `toLevel(problem, 'problem:'+localId)` →
    `game.openCustomLevel(level, { onComplete: stars → testedHash = problemHash, best stars merged;
onExit: back to editor 'test' })`.
  - `exit()`: flush autosave, return to `problems` screen.
  - Autosave: debounced 500 ms on any change; also flushed by `exit()` and `visibilitychange`
    → hidden (Review Focus 4); `saveFailed` set when `saveDrafts` returns false (Review Focus 2).

- [ ] **Step 1: Failing tests** (jsdom; real game store with null storage):
  - Setup A,B then Solve: two circles + intersection + line → `solution` has 4 steps; nudge set on
    step 2 survives an undo/redo of step 4.
  - Delete A in Setup → `broken === 0`, steps kept; re-adding nothing and calling `removeFrom(0)`
    clears them (Review Focus 3). Moving B so two circles no longer meet → `broken` = intersection
    step index.
  - `toggleTarget` on the line → validation ok for a complete details set; par below solution
    clamps up.
  - `startTest` blocked while invalid; after solving in test, `tested` true; any edit → false.
  - Autosave writes after 500 ms (fake timers), `exit()` flushes immediately, a throwing storage
    sets `saveFailed` and keeps state.
- [ ] **Step 2–4:** RED, implement, GREEN; typecheck, lint.
- [ ] **Step 5: Commit** `feat(editor): editor model with setup, solve sync, details, test`.

---

### Task 8: Setup canvas

**Files:**

- Create: `src/editor/SetupCanvas.tsx`, `src/editor/editor.css`
- Test: `tests/unit/editor/SetupCanvas.test.tsx`

**Interfaces:**

- Consumes: `SceneLayer`, `useViewport`, `findSnap`, `Magnifier`, `SNAP_RADIUS`, Task 6 reducer,
  Task 7 `applySetup`.
- Produces `<SetupCanvas editor={Editor} tool={SetupTool} hideCentre={boolean} />` rendering the
  setup scene (evaluated `setup.givens`) with the same pointer flow as the game canvas (pointer
  capture, touch magnifier, second finger cancels and pans/pinches) and the reducer's preview as a
  ghost; hidden circles show centre and rim handles only in the editor; `data-testid="setup-canvas"`.
- Viewport: fit to `frame` of the setup points (fallback a 8×6 world box at origin when < 2
  points), refit on resize until the user pans.

- [ ] **Step 1: Failing tests (jsdom):** renders `[data-kind="point"][data-label="A"]` after an
      `add`; a pointer tap sequence (dispatched PointerEvents with mocked `getBoundingClientRect`)
      on empty space with the point tool calls `applySetup` with an `add`.
- [ ] **Step 2–4:** RED, implement, GREEN. Then a scratchpad Playwright look at 390×844 and
      1280×800 (place points, draw segment/circle, drag a point) — screenshots Read and refined.
- [ ] **Step 5: Commit** `feat(editor): setup canvas`.

---

### Task 9: Editor screen — mode bar, Setup and Solve UI

**Files:**

- Create: `src/editor/EditorScreen.tsx`, `src/editor/ModeBar.tsx`, `src/editor/SetupPalette.tsx`,
  `src/editor/StepsPanel.tsx`
- Modify: `src/ui/App.tsx` (route `editor`), `src/ui/GameScreen.tsx` (when the current custom
  level is a sandbox, render the StepsPanel slot passed by the editor instead of the hint button)
- Test: `tests/unit/editor/EditorScreen.test.tsx`

**Interfaces:**

- Consumes: Tasks 7–8; `GameScreen` for Solve (rendered with a `sidePanel` prop: `ComponentChildren`).
- Produces: `<EditorScreen editor={Editor} />`.
  - ModeBar: segmented control `Setup · Solve · Details · Test` (`role="tablist"`, ✓ per
    `modeDone`); `Back` (calls `editor.exit()`).
  - SetupPalette tools Point, Segment, Ray, Line, Circle (+ `Hide centre` toggle), Delete, Undo,
    Redo; keys 1–5.
  - StepsPanel rows: step number, `describe()` of its objects, ☆ toggle per object
    (aria-pressed, gold when on), hint input (`maxLength=120`, live counter), red `Broken` flag and
    `Remove from here` on broken rows; right side ≥ 768 px, bottom sheet below. Targets glow on the
    canvas via the existing `coach` ids prop of `Canvas`.

- [ ] **Step 1: Failing tests:** tabs switch modes; Setup palette selects tools; in Solve, the
      StepsPanel lists steps after `game.apply` and the ☆ toggles `targets`; a broken step shows
      `Broken` and `Remove from here`.
- [ ] **Step 2–4:** RED, implement, GREEN; scratchpad Playwright screenshots at both sizes,
      light and dark; refine.
- [ ] **Step 5: Commit** `feat(editor): editor screen with setup and solve`.

---

### Task 10: Details and Test modes

**Files:**

- Create: `src/editor/DetailsPanel.tsx`, `src/editor/ValidationList.tsx`
- Modify: `src/editor/EditorScreen.tsx`
- Test: `tests/unit/editor/DetailsPanel.test.tsx`

**Interfaces:**

- DetailsPanel: labelled inputs title (40), goal sentence (120), explanation (200, textarea),
  author (40) with live counters; tool switches (Point/Line/Circle disabled-on, Perpendicular
  bisector toggle); par steppers showing `L x · E y` clamped to ≥ solution.
- ValidationList: every error as a row with ✗ and message, a ✓ `Ready to test` row when ok;
  clicking an error switches to the mode it concerns (`path` prefix `givens`→setup,
  `solution`/`targets`→solve, else details); results announced via a polite live region.
- Test mode: a `Play test` primary button (disabled with reason when invalid) calling
  `startTest()`; shows `Tested ✓` when `tested`.

- [ ] **Step 1: Failing tests:** counters update; title over limit blocked by `maxLength`; par
      stepper cannot go below the solution; an invalid problem lists its error and disables `Play
test`; a valid one enables it; clicking a `solution` error switches to Solve.
- [ ] **Step 2–4:** RED, implement, GREEN; screenshots.
- [ ] **Step 5: Commit** `feat(editor): details, validation and test modes`.

---

### Task 11: My problems, entry points, import/export

**Files:**

- Create: `src/ui/ProblemsScreen.tsx`, `src/problems/io.ts`
- Modify: `src/ui/App.tsx` (route `problems`), `src/ui/TitleScreen.tsx` and `src/ui/LevelMap.tsx`
  (a `Create` entry), `src/state/store.ts` (`goToProblems()`)
- Test: `tests/unit/ui/ProblemsScreen.test.tsx`, `tests/unit/problems/io.test.ts`

**Interfaces:**

- `io.ts`: `exportProblem(p: Problem): { filename: string; text: string }` (`<slug>.apollonius.json`,
  pretty JSON); `importProblemText(text: string): ReturnType<typeof validate>`;
  `MAX_IMPORT_BYTES = 200_000` checked on `File.size` before reading (Review Focus 1).
- ProblemsScreen: list newest first (title or `Untitled`, status `Draft`/`Valid`/`Tested ✓`, best
  stars); actions New, Open, Play (valid only; via `toLevel` + `openCustomLevel`, stars saved to
  the draft), Duplicate, Delete (undo toast 5 s), Export, Import (file input `accept=".json"`;
  errors shown in a dialog listing messages); note `Uploading to the public gallery is coming`;
  `saveFailed` warning `Couldn't save drafts on this device.`
- Title screen and map gain a secondary `Create` button → `goToProblems()`.

- [ ] **Step 1: Failing tests:** export filename/slug; import of a 300 KB file rejected with a
      size message without reading; non-JSON → message; invalid problem → errors listed; valid →
      added as a new draft; delete + undo restores; Play opens a custom level.
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `feat: my problems screen with import and export`.

---

### Task 12: End-to-end flows and visual review

**Files:**

- Create: `tests/e2e/editor.spec.ts` (reuse `tests/e2e/helpers.ts`)

- [ ] **Step 1: Specs (desktop mouse + mobile touch):**
  - From the title, `Create` → New → Setup: place A and B, draw segment AB → Solve: circle A→B,
    circle B→A, tap upper crossing, lines to A and B; ☆ both lines → Details: title, goal, author
    → validation shows `Ready to test` → Test: `Play test`, solve, completion → `Back` → `Tested ✓`.
  - Export (download event) → Import that file → it appears and `Play` completes it.
  - Moving B so a needed crossing is under 40 px from A shows the untappable error and disables
    `Play test`.
  - A built-in level played afterwards still shows its original stars (progress untouched).
- [ ] **Step 2:** `pnpm e2e` → fix failures in the owning module, never in tests; repeat until
      green on both projects. Full `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e && pnpm build`.
- [ ] **Step 3: Visual review:** screenshots of My problems, each editor mode and the custom
      completion card at both sizes, light and dark, saved to `test-results/screens/`; Read every one
      against the game's §6 visual direction; fix and re-shoot.
- [ ] **Step 4: Commit** `test(editor): end-to-end authoring, test-play and import/export`.

## Spec coverage

| Spec                                                | Tasks                                  |
| --------------------------------------------------- | -------------------------------------- |
| §2 format                                           | 1, 2                                   |
| §3 loader, Level widening                           | 3, 4                                   |
| §4 validation, hash, tappability                    | 1, 2                                   |
| §5.1–5.3 Setup, Solve, steps, targets               | 6, 7, 8, 9                             |
| §5.4–5.5 Details, par, checklist, Test, tested mark | 7, 10                                  |
| §5.6 layout, a11y                                   | 8, 9, 10, 12                           |
| §6 My problems, storage, import/export, custom play | 4, 5, 11                               |
| §7 architecture                                     | all                                    |
| §8 testing                                          | every task; 12                         |
| §9 phase-2 readiness                                | 1 (hash), 2 (pure validate), 11 (note) |
