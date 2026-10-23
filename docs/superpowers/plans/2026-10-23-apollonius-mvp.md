# Apollonius MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Apollonius MVP: a six-level, Euclidea-style compass-and-straightedge
puzzle game as a static, responsive web app that works equally well with mouse and touch.

**Architecture:** A pure TypeScript geometry core and construction graph (no DOM) feed level
goal predicates, a robustness check and a small fact/hint layer. A Preact + SVG canvas turns
pointer gestures into commands through a pure gesture reducer. A signals-based store holds
UI state and persists progress to `localStorage`. Dependencies point one way:
`ui → canvas → state → reasoning/levels → construction → geometry`.

**Tech Stack:** Vite 8, TypeScript 5.9 (strict), Preact 10.29 + @preact/signals 2,
Vitest 5, Playwright 1.56 (Chromium), ESLint 10 + typescript-eslint, Prettier, pnpm,
@fontsource-variable/inter and @fontsource-variable/fraunces.

**Spec:** `docs/superpowers/specs/2026-10-23-apollonius-design.md`. Read it before
starting any task. Section references below (§5.2 etc.) point into it.

## Global Constraints

- Static site only: no backend, no accounts, no runtime CDN requests (fonts self-hosted).
- English copy only. No sound.
- Geometry functions return `null` (or `[]`) for degenerate input and never throw (§7.5).
- Equality tolerance: `1e-9 × scene diameter` (§7.2).
- Snap radius: 14 px mouse/pen, 24 px touch, in screen space (§5.2).
- Snap priority: existing point > candidate intersection > curve > empty; ties → nearest.
- Robustness: 5 perturbations, each given point moved by up to 10% of scene size; free
  points keep their parameters; any `null` in a rebuild fails the check (§7.2, §7.5).
- Move costs: line 1L/1E, circle 1L/1E, perpendicular bisector 1L/3E; points and
  intersections free (§4.1).
- Stars `[reached, L ≤ target, E ≤ target]`, independent, best-ever kept per star; hints
  never cost stars (§4.3).
- Persistence key `apollonius:v1`, shape `{ version: 1, levels: { [id]: { stars:
  [boolean, boolean, boolean], hintsUsed: number } }, unlockedTools: string[], theme?:
  'light' | 'dark' }` (§7.4).
- Colour tokens, stroke widths and timings exactly as §6 (220 ms draw-on, 150–200 ms UI,
  120 ms star stagger, 35% ghost opacity, 80 ms fades under reduced motion).
- Palette at the bottom below 768 px viewport width, left side at or above it (§5.5).
- Every user-visible animation honours `prefers-reduced-motion` (§5.7).
- Commit messages end with the session attribution lines; no model names in the repo.

## Review Focus

1. **A gesture interrupted mid-drag** (pointercancel from the OS, release outside the canvas,
   release over empty space with the line tool) must commit nothing and clear the ghost.
   → Task 11 tests `cancel`/`up-on-empty` transitions.
2. **A second finger landing during a line/circle drag** must cancel the construction
   gesture and hand over to pinch/pan, never commit a half-finished object.
   → Task 11 `cancel` test + Task 12 multi-pointer E2E check in Task 18.
3. **Undo pressed during a draw-on animation, or a new command after undo** must leave no
   stale object in the DOM and must drop the redo tail.
   → Task 2 truncation test; Task 18 E2E "rapid undo" test.
4. **`localStorage` unavailable or throwing** (private mode, quota) must leave the game
   fully playable with in-memory progress.
   → Task 7 persistence tests with a throwing storage.
5. **Viewport resize or orientation change mid-level** must keep all givens visible (refit
   unless the player has zoomed/panned) and move the palette across the 768 px breakpoint.
   → Task 9 `fit` test; Task 18 E2E resize test.

---

## File Structure

```
index.html
package.json, tsconfig.json, vite.config.ts, vitest.config.ts (in vite.config),
eslint.config.js, .prettierrc, playwright.config.ts
src/
  main.tsx                 mounts <App/>
  geometry/
    vec.ts                 Vec type + vector ops
    curves.ts              LineG, CircleG, constructors, param/pointAt, equality
    intersect.ts           intersect(a, b) with stable index ordering
    tolerance.ts           tol(sceneDiameter)
  construction/
    types.ts               ObjId, ObjDef, ConstructionObject, Command, Scene
    evaluate.ts            evaluate(defs, givenOverrides) → values
    construction.ts        Construction class: apply/undo/redo/reset, moves, labels
    describe.ts            human description of an object (live region, a11y)
  levels/
    types.ts               Level, ReferenceStep, GoalMatch, CoachStep
    goals.ts               shared predicates (hasLine, hasPoint, …)
    l1-equilateral.ts … l6-circle-center.ts
    index.ts               LEVELS array, levelById
  reasoning/
    robustness.ts          isRobust(level, construction, rng)
    facts.ts               deriveFacts(scene)
    hints.ts               nextHint(level, scene)
    stars.ts               scoreStars, mergeStars
  state/
    persistence.ts         loadProgress, saveProgress
    store.ts               signals + actions
  canvas/
    viewport.ts            Viewport transforms, zoomAt, pan, fit
    candidates.ts          candidateIntersections(scene)
    snap.ts                findSnap(...)
    gestures.ts            gestureReducer (pure state machine)
    Canvas.tsx             SVG host, pointer plumbing, pinch/pan, keyboard
    SceneLayer.tsx         renders objects, candidates, ghost, highlights
    shapes.ts              svg path builders (line clip, circle-from-point path)
    Magnifier.tsx          touch loupe
  ui/
    App.tsx                screen routing
    TitleScreen.tsx, LevelMap.tsx, GameScreen.tsx, TopBar.tsx, ToolPalette.tsx,
    HintPanel.tsx, CompletionCard.tsx, CoachMark.tsx, ThemeToggle.tsx, icons.tsx
  styles/
    tokens.css             colour/timing tokens, light + dark
    base.css               layout, typography, motion utilities
tests/
  unit/…                   mirrors src/
  e2e/…                    Playwright specs + helpers
```

---

### Task 1: Project scaffold and geometry core

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`,
  `.prettierrc`, `.gitignore`, `index.html`, `src/main.tsx` (renders a placeholder `<div>`)
- Create: `src/geometry/vec.ts`, `src/geometry/curves.ts`, `src/geometry/intersect.ts`,
  `src/geometry/tolerance.ts`
- Test: `tests/unit/geometry/curves.test.ts`, `tests/unit/geometry/intersect.test.ts`

**Interfaces:**
- Produces:
  - `type Vec = { x: number; y: number }`; `add, sub, scale(v, k), dot, cross, len, dist,
    normalize(v): Vec | null, perp(v): Vec` (rotate +90°: `{x: -v.y, y: v.x}`)
  - `type LineG = { kind: 'line'; p: Vec; d: Vec }` (`d` unit length)
  - `type CircleG = { kind: 'circle'; c: Vec; r: number }`; `type Curve = LineG | CircleG`
  - `lineThrough(a: Vec, b: Vec): LineG | null` — `p = a`, `d = normalize(b − a)`
  - `circleThrough(c: Vec, q: Vec): CircleG | null` — `r = dist(c, q)`, null if `r = 0`
  - `perpBisector(a: Vec, b: Vec): LineG | null` — `p = midpoint`, `d = perp(normalize(b − a))`
  - `paramOf(curve: Curve, q: Vec): number` (line: signed distance along `d` from `p`;
    circle: `atan2` angle) and `pointAt(curve: Curve, t: number): Vec`
  - `eqPoint(a, b, tol)`, `eqCurve(a: Curve, b: Curve, tol)` (lines equal as point sets,
    direction sign ignored), `onCurve(q: Vec, c: Curve, tol)`, `distToCurve(q, c)`
  - `intersect(a: Curve, b: Curve, tol: number): Vec[]` — length 0, 1 or 2
  - `tol(sceneDiameter: number): number` = `1e-9 * sceneDiameter`

- [ ] **Step 1: Scaffold the project.** `pnpm init`; add dependencies (`preact@^10.29.8`,
  `@preact/signals@^2.11.3`, `@fontsource-variable/inter@^5.3.0`,
  `@fontsource-variable/fraunces@^5.3.0`) and dev dependencies (`vite@^8.3.5`,
  `@preact/preset-vite@^2.10.6`, `typescript@~5.9.3`, `vitest@^5.0.5`, `jsdom`,
  `@playwright/test@1.56.1`, `eslint@^10`, `typescript-eslint@^8.72`, `prettier`).
  Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `typecheck`, `lint`,
  `test` (`vitest run`), `e2e` (`playwright test`). `tsconfig`: `strict`,
  `noUncheckedIndexedAccess`, `jsx: react-jsx`, `jsxImportSource: preact`. Vitest config
  lives in `vite.config.ts` (`test.include: ['tests/unit/**/*.test.ts?(x)']`,
  `environment: 'node'`; UI tests opt into jsdom with a file comment).
- [ ] **Step 2: Verify the scaffold.** Run `pnpm build && pnpm lint`. Expected: both exit 0.
- [ ] **Step 3: Write failing geometry tests.**

```ts
// curves.test.ts
test('lineThrough is null for coincident points', () =>
  expect(lineThrough({x:1,y:1},{x:1,y:1})).toBeNull());
test('perpBisector of (0,0),(2,0) is x = 1', () => {
  const l = perpBisector({x:0,y:0},{x:2,y:0})!;
  expect(eqCurve(l, lineThrough({x:1,y:-5},{x:1,y:5})!, 1e-9)).toBe(true);
});
test('eqCurve ignores line direction', () =>
  expect(eqCurve(lineThrough({x:0,y:0},{x:1,y:1})!, lineThrough({x:2,y:2},{x:-1,y:-1})!, 1e-9)).toBe(true));
test('pointAt(paramOf(q)) round-trips on line and circle', …);
test('circleThrough is null for zero radius', …);

// intersect.test.ts
test('parallel lines → []', …);
test('line–line crossing → one point', …);
test('circle–circle two points; index 0 is left of c1→c2', () => {
  const pts = intersect(circleThrough({x:0,y:0},{x:2,y:0})!, circleThrough({x:2,y:0},{x:0,y:0})!, 1e-9);
  expect(pts).toHaveLength(2);
  expect(cross(sub({x:2,y:0},{x:0,y:0}), sub(pts[0]!, {x:0,y:0}))).toBeGreaterThan(0);
});
test('externally tangent circles → exactly one point', …);
test('concentric / disjoint circles → []', …);
test('line–circle: index 0 has smaller paramOf along the line', …);
test('tangent line–circle → one point', …);
```

- [ ] **Step 4: Run.** `pnpm test tests/unit/geometry` → FAIL (modules missing).
- [ ] **Step 5: Implement** the four geometry files. Ordering rules (these make
  intersection identity stable when givens are perturbed — the robustness check depends on
  it): circle–circle sorts so index 0 has positive `cross(c2 − c1, pt − c1)`; line–circle
  and line–line sort by `paramOf(line, pt)` ascending (for line–circle use the line's
  param; when the line is the second argument, still sort by that line's param). Tangency:
  treat discriminant within `tol` of zero as one point.
- [ ] **Step 6: Run.** `pnpm test tests/unit/geometry` → PASS. `pnpm typecheck && pnpm lint` → 0.
- [ ] **Step 7: Commit** `feat: scaffold project and geometry core`.

---

### Task 2: Construction graph, commands, undo/redo and move counting

**Files:**
- Create: `src/construction/types.ts`, `src/construction/evaluate.ts`,
  `src/construction/construction.ts`, `src/construction/describe.ts`
- Test: `tests/unit/construction/construction.test.ts`, `tests/unit/construction/describe.test.ts`

**Interfaces:**
- Consumes: Task 1 geometry.
- Produces:
  - `type ObjId = string`
  - `type ObjDef =`
    `| { type: 'given-point'; pos: Vec }`
    `| { type: 'given-line'; a: ObjId; b: ObjId; extent: 'line' | 'segment' | 'ray' }`
    `| { type: 'given-circle'; c: Vec; r: number }`
    `| { type: 'free-point'; pos: Vec }`
    `| { type: 'on-curve'; curve: ObjId; t: number }`
    `| { type: 'intersection'; a: ObjId; b: ObjId; index: 0 | 1 }`
    `| { type: 'line'; a: ObjId; b: ObjId }`
    `| { type: 'circle'; center: ObjId; through: ObjId }`
    `| { type: 'perp-bisector'; a: ObjId; b: ObjId }`
  - `type Value = Vec | Curve | null`;
    `interface SceneObject { id: ObjId; def: ObjDef; value: Value; label?: string; given: boolean }`
  - `interface Scene { objects: SceneObject[]; byId: Map<ObjId, SceneObject>; tol: number }`
  - `type ObjSpec = { id: ObjId; def: ObjDef }`
  - `type Command = { type: 'add'; objects: ObjSpec[] } | { type: 'reset' }`
  - `type ApplyResult = { ok: true; ids: ObjId[] } | { ok: false; reason: 'degenerate' }
    | { ok: false; reason: 'duplicate'; existingId: ObjId }`
  - `evaluate(specs: ObjSpec[], sceneDiameter: number, overrides?: Map<ObjId, ObjDef>): Scene`
    — evaluates in order; an object whose parent value is `null` gets `null`
  - `class Construction`:
    `constructor(givens: ObjSpec[], givenLabels: Record<ObjId, string>, sceneDiameter: number)`;
    `scene(): Scene`; `allocId(): ObjId` (`'o1'`, `'o2'`, …);
    `apply(cmd: Command): ApplyResult`; `undo(): boolean`; `redo(): boolean`;
    `canUndo(): boolean`; `canRedo(): boolean`; `moves(): { L: number; E: number }`;
    `specs(): ObjSpec[]` (givens + current objects, in order); `lastChange(): { added:
    ObjId[]; removed: ObjId[] }` (diff caused by the latest apply/undo/redo, for animation)
  - `describe(obj: SceneObject, scene: Scene): string`

- [ ] **Step 1: Write failing tests.**

```ts
const givens = [{id:'A',def:{type:'given-point',pos:{x:0,y:0}}},{id:'B',def:{type:'given-point',pos:{x:2,y:0}}}];
const mk = () => new Construction(givens, {A:'A',B:'B'}, 10);

test('adding a circle counts 1L 1E', …);                       // moves() → {L:1,E:1}
test('perp-bisector counts 1L 3E', …);
test('points and intersections are free', …);
test('undo removes the last command; redo restores it', …);
test('apply after undo truncates the redo tail', () => {        // Review Focus 3
  const c = mk(); c.apply(addCircle('A','B')); c.undo(); c.apply(addCircle('B','A'));
  expect(c.canRedo()).toBe(false);
});
test('reset clears non-givens and is itself undoable', …);
test('duplicate circle is rejected with existingId and no move is counted', …);
test('line A→A is degenerate', () => expect(mk().apply(addLine('A','A'))).toEqual({ok:false, reason:'degenerate'}));
test('player points are labelled C, D, E … skipping given labels', …);
test('evaluate with overrides recomputes dependants', …);      // move B, circle radius changes
test('dependant of a null value is null', …);
test('lastChange reports added ids after apply and removed ids after undo', …);

// describe.test.ts
expect(describe(circleObj, scene)).toBe('Circle centered at A through B');
expect(describe(lineObj, scene)).toBe('Line through A and C');
expect(describe(perpObj, scene)).toBe('Perpendicular bisector of A and B');
expect(describe(pointObj, scene)).toBe('Point C');
```

- [ ] **Step 2: Run** `pnpm test tests/unit/construction` → FAIL.
- [ ] **Step 3: Implement.** History is `commands: Command[]` plus `cursor`; the current
  object list is givens plus every `add` after the last `reset` up to `cursor`, re-evaluated
  with `evaluate`. A command is rejected as `degenerate` if any new object's value is
  `null`, and as `duplicate` if a new curve `eqCurve`s an existing curve (return the
  existing id). Labels are assigned to point objects when they are first evaluated, in
  creation order, from `C…Z` skipping labels already used by givens; undo frees the label.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck && pnpm lint` → 0.
- [ ] **Step 5: Commit** `feat: construction graph with undo/redo and move counting`.

---

### Task 3: Level definitions, goal predicates and reference solutions

**Files:**
- Create: `src/levels/types.ts`, `src/levels/goals.ts`, `src/levels/l1-equilateral.ts`,
  `l2-perp-bisector.ts`, `l3-midpoint.ts`, `l4-perpendicular.ts`, `l5-angle-bisector.ts`,
  `l6-circle-center.ts`, `src/levels/index.ts`
- Test: `tests/unit/levels/levels.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `type ToolId = 'point' | 'line' | 'circle' | 'perp-bisector'`
  - `type LevelId = 'equilateral' | 'perp-bisector' | 'midpoint' | 'perpendicular' |
    'angle-bisector' | 'circle-center'`
  - `interface GoalMatch { ids: ObjId[]; gold: (Vec | Curve)[] }` (`ids` = player objects
    satisfying the goal; `gold` = geometry drawn in gold on completion)
  - `interface ReferenceStep { objects: ObjSpec[]; nudge: string }`
  - `interface CoachStep { text: string; target: ObjId[]; doneWhen: (s: Scene) => boolean }`
  - `interface Level { id: LevelId; number: number; title: string; goalText: string;
    givens: ObjSpec[]; labels: Record<ObjId, string>; view: { x: number; y: number;
    w: number; h: number }; sceneDiameter: number; targets: { L: number; E: number };
    tools: ToolId[]; unlocks?: ToolId; goal: (s: Scene) => GoalMatch | null;
    reference: ReferenceStep[]; explain: (facts: Fact[], s: Scene, m: GoalMatch) => string;
    coach?: CoachStep[]; tip?: string }`
  - `type Fact =`
    `| { kind: 'on-circle'; point: ObjId; circle: ObjId }`
    `| { kind: 'equal-radius'; circles: [ObjId, ObjId] }`
    `| { kind: 'equidistant'; point: ObjId; from: [ObjId, ObjId] }`
    `| { kind: 'perp-bisector'; line: ObjId; of: [ObjId, ObjId] }`
    (declared here so levels need not import `reasoning/`; each level's `explain` returns
    `''` until Task 5 fills it in)
  - `LEVELS: Level[]` (order 1–6), `levelById(id: LevelId): Level`
  - `goals.ts`: `findLine(s, a: Vec, b: Vec): SceneObject | undefined`,
    `findCurveEq(s, c: Curve)`, `findPointAt(s, p: Vec)`, `pos(s, id): Vec`

Level content (copy titles and goal text exactly; L/E from §4.2):

| id | title | goalText | givens (world coords) | tools | L/E |
|---|---|---|---|---|---|
| equilateral | Equilateral Triangle | Construct an equilateral triangle on AB. | A(−1,0), B(1,0), segment AB | point, line, circle | 4/4 |
| perp-bisector | Perpendicular Bisector | Construct the perpendicular bisector of AB. | A(−1,0), B(1,0) | point, line, circle | 3/3 |
| midpoint | Midpoint | Construct the midpoint of AB. | A(−1.2,0), B(1.2,0), segment AB | point, line, circle | 3/3 |
| perpendicular | Perpendicular at a Point | Construct the line through P perpendicular to ℓ. | A(−1.5,0.2), P(0.3,0.5), line ℓ = AP (extent line) | + perp-bisector | 2/4 |
| angle-bisector | Angle Bisector | Construct the bisector of angle AVB. | V(−1.5,0), A(1.5,1.2), B(1.5,−0.9), rays VA, VB | + perp-bisector | 2/4 |
| circle-center | Circle Center | Construct the center of the circle. | circle c=(0.2,−0.1), r=1.4 | + perp-bisector | 2/6 |

`unlocks: 'perp-bisector'` on `midpoint`. Every level's `view` frames its givens with ~35%
margin; `sceneDiameter` is the view's diagonal.

Goals (each recomputes its target from the scene's current given values, never constants):
- equilateral: some point `C` with `dist(C,A) ≈ dist(A,B) ≈ dist(C,B)` and lines through
  A,C and B,C both present.
- perp-bisector: a curve equal to `perpBisector(A, B)`.
- midpoint: a point at the midpoint of AB.
- perpendicular: a line through P with direction ⟂ ℓ.
- angle-bisector: a line equal to the internal bisector of ∠AVB.
- circle-center: a point at the given circle's centre.

Reference solutions (each step's nudge copy is exact):
1. equilateral: circle A→B ("Which points are exactly AB away from A?"); circle B→A
   ("…and exactly AB away from B?"); intersection idx 0 → C ("Where do those two sets
   meet?"); line A–C, line B–C ("Join the new point to A and B.").
2. perp-bisector: circle A→B, circle B→A ("Which points are the same distance from A and
   from B?"); both intersections ("Mark where the circles cross."); line through them
   ("Every point on one line is equidistant from A and B.").
3. midpoint: as level 2, then intersection of that line with AB ("The midpoint sits where
   the bisector crosses AB.").
4. perpendicular: circle P→A ("Make a second point on ℓ, as far from P as A is."); its
   intersection idx 1 with ℓ → A′ ("Mark it."); perp-bisector A,A′ ("P is now the midpoint
   of A and A′.").
5. angle-bisector: circle V→A ("Find a point on VB as far from V as A is."); intersection
   idx 1 with ray VB → B′; perp-bisector A,B′ ("Points equidistant from A and B′ include V.").
6. circle-center: three on-curve points at t = 0.3, 2.2, 4.1 ("Any chord's perpendicular
   bisector passes through the centre."); perp-bisector of the first two; perp-bisector of
   the last two; their intersection ("Two such lines meet at the centre.").

- [ ] **Step 1: Write failing tests** (parametrised over `LEVELS`):

```ts
test.each(LEVELS)('$id: reference solution reaches the goal', lvl => {
  const c = playReference(lvl);                    // helper in tests/unit/helpers.ts: applies each step
  expect(lvl.goal(c.scene())).not.toBeNull();
});
test.each(LEVELS)('$id: reference meets L/E targets', lvl => {
  const m = playReference(lvl).moves();
  expect(m.L).toBeLessThanOrEqual(lvl.targets.L); expect(m.E).toBeLessThanOrEqual(lvl.targets.E);
});
test.each(LEVELS)('$id: givens alone do not satisfy the goal', …);
test('equilateral: lines to only one intersection side still pass (idx 1 also valid)', …);
test('equilateral: isosceles near-miss (C slightly off) fails', …);
test('perp-bisector: a line through only one circle intersection and A fails', …);
test('perpendicular: a line through P at 89.9° fails', …);
test('angle-bisector: the external bisector fails', …);
test('levels 1–3 do not offer perp-bisector; 4–6 do', …);
```

- [ ] **Step 2: Run** `pnpm test tests/unit/levels` → FAIL.
- [ ] **Step 3: Implement** the level files and `goals.ts`. Use the L/E values in the
  table; if a reference solution comes in under a target, lower the target to match and
  note it in the commit message (§4.2).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: six levels with goal predicates and reference solutions`.

---

### Task 4: Robustness check

**Files:**
- Create: `src/reasoning/robustness.ts`
- Test: `tests/unit/reasoning/robustness.test.ts`

**Interfaces:**
- Consumes: `Level`, `Construction.specs()`, `evaluate`.
- Produces: `isRobust(level: Level, specs: ObjSpec[], rng?: () => number, trials = 5): boolean`;
  `perturbGivens(level: Level, rng: () => number): Map<ObjId, ObjDef>`;
  `mulberry32(seed: number): () => number` (deterministic RNG for tests).

- [ ] **Step 1: Failing tests.**

```ts
test.each(LEVELS)('$id: reference solution is robust', lvl =>
  expect(isRobust(lvl, playReference(lvl).specs(), mulberry32(1))).toBe(true));
test('midpoint: a free point placed exactly at the midpoint is not robust', () => {
  const lvl = levelById('midpoint');
  const specs = [...lvl.givens, {id:'o1', def:{type:'free-point', pos:{x:0,y:0}}}];
  expect(lvl.goal(evaluate(specs, lvl.sceneDiameter))).not.toBeNull();
  expect(isRobust(lvl, specs, mulberry32(1))).toBe(false);
});
test('a rebuild containing null fails', …);
test('perturbation moves each given point by at most 10% of sceneDiameter', …);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** `given-point` positions move by a
  random vector of length ≤ `0.1 × sceneDiameter`; `given-circle` centre likewise and radius
  scaled by `1 ± 0.1`. Free and on-curve points keep their stored `pos`/`t`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: robustness check against coincidental solutions`.

---

### Task 5: Fact layer, explanations and stars

**Files:**
- Create: `src/reasoning/facts.ts`, `src/reasoning/stars.ts`
- Modify: each `src/levels/l*.ts` — fill in `explain`
- Test: `tests/unit/reasoning/facts.test.ts`, `tests/unit/reasoning/stars.test.ts`

**Interfaces:**
- Consumes: `Fact` from `src/levels/types.ts` (Task 3).
- Produces:
  - `deriveFacts(s: Scene): Fact[]`
  - `scoreStars(m: {L:number;E:number}, t: {L:number;E:number}): [boolean, boolean, boolean]`
  - `mergeStars(a: [boolean,boolean,boolean], b: …): [boolean,boolean,boolean]` (element-wise OR)

Derivation rules: `on-circle` from a `circle`'s `through` point, from intersections and
on-curve points on circles; `equal-radius` when two circles' radii are equal within tol;
`equidistant` when a point is on two equal-radius circles centred at `a` and `b`;
`perp-bisector` from a `perp-bisector` def, or a line through two points that are both
`equidistant` from the same pair.

Explanation copy (exact, with labels substituted; `X`, `Y` = player-point labels):
1. `"C lies on both circles, so CA = AB = CB."`
2. `"X and Y are each equidistant from A and B, so the line XY is the perpendicular bisector."`
3. `"The perpendicular bisector of AB crosses it exactly halfway, at M."` (`M` = goal point label)
4. `"P is the midpoint of A and A′, so the bisector of AA′ is perpendicular to ℓ at P."`
   (use the actual label of A′)
5. `"VA = VB′, so V lies on the perpendicular bisector of AB′ — which splits the angle evenly."`
6. `"Both lines are perpendicular bisectors of chords, so each passes through the centre."`
Each level falls back to `"Solved — every step is a valid construction."` when the
facts its sentence relies on are absent (alternative solutions).

- [ ] **Step 1: Failing tests.**

```ts
test('equilateral reference: C is on both circles', …);         // two on-circle facts
test('perp-bisector reference: line is a derived perp-bisector of A,B', …);
test.each(LEVELS)('$id: explain() of the reference returns its exact sentence', …);
test('alternative solution without expected facts gets the fallback sentence', …);
test('scoreStars({L:4,E:6},{L:4,E:4}) → [true,true,false]', …);
test('mergeStars keeps best per star', …);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: fact derivation, explanations and star scoring`.

---

### Task 6: Hint engine

**Files:**
- Create: `src/reasoning/hints.ts`
- Test: `tests/unit/reasoning/hints.test.ts`

**Interfaces:**
- Produces: `interface Hint { stepIndex: number; nudge: string; inputIds: ObjId[];
  ghost: (Vec | Curve)[] }`; `nextHint(level: Level, scene: Scene): Hint | null`
  (`null` when the goal is already met).

Algorithm: evaluate the reference specs against the scene's current given values. Map each
reference object to a player object with an equal value (`eqPoint`/`eqCurve` at the
scene's tol); givens map to themselves. Reference `free-point`/`on-curve` points are
placeholders for "any point": each maps to any unmapped player point of the same kind on
the same curve (or any unmapped free point), so a player's own chord points in level 6
count as progress. The target is the first step that has an unmapped
object and whose inputs (referenced ids outside the step) are all mapped. `inputIds` are
the mapped player ids of those inputs; `ghost` are the step's unmapped values. If the player
has at least one non-given object and no non-given reference object is mapped, prepend the
nudge with `"Try starting from the given points. "`.

- [ ] **Step 1: Failing tests.**

```ts
test('empty scene → step 0 with its nudge', …);
test('after first reference circle → step 1', …);
test('equivalent progress in a different order is recognised', () => {
  // equilateral: player draws circle B→A first, then asks → targets circle A→B (step 0), not step 1
});
test('player circles drawn in another order still map (step order irrelevant)', …);
test('unrelated objects only → nudge starts with "Try starting from the given points."', …);
test('inputIds refer to player ids, not reference ids', …);
test('circle-center: player points at other angles still map to the reference points', …);
test('goal met → null', …);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: progress-matching hint engine`.

---

### Task 7: Persistence and game store

**Files:**
- Create: `src/state/persistence.ts`, `src/state/store.ts`
- Test: `tests/unit/state/persistence.test.ts`, `tests/unit/state/store.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `interface Progress { version: 1; levels: Partial<Record<LevelId, { stars: [boolean,
    boolean, boolean]; hintsUsed: number }>>; unlockedTools: ToolId[]; theme?: 'light' |
    'dark' }`
  - `loadProgress(storage: Pick<Storage,'getItem'> | null): Progress`;
    `saveProgress(storage: Pick<Storage,'setItem'> | null, p: Progress): void`;
    `safeStorage(): Storage | null` (returns `null` if access throws)
  - `createStore(storage: Storage | null)` returning signals and actions:
    `screen: Signal<'title' | 'map' | 'level'>`, `levelId: Signal<LevelId>`,
    `tool: Signal<ToolId>`, `revision: Signal<number>`, `construction(): Construction`,
    `hintTier: Signal<0 | 1 | 2 | 3>`, `hint: ReadonlySignal<Hint | null>`,
    `completion: Signal<null | { stars: [boolean,boolean,boolean]; explanation: string;
    match: GoalMatch; unlocked?: ToolId }>`, `progress: Signal<Progress>`,
    `lastResult: Signal<ApplyResult | null>`;
    actions `openLevel(id)`, `selectTool(t)`, `apply(cmd): ApplyResult`, `undo()`, `redo()`,
    `reset()`, `requestHint()`, `nextLevel()`, `goToMap()`, `resumeLevel(): LevelId`,
    `isUnlocked(id: LevelId): boolean`, `setTheme(t)`.

Behaviour: after every `apply`/`undo`/`redo`/`reset`, bump `revision`; if not already
completed and `goal(scene)` is non-null and `isRobust(...)`, set `completion` (stars from
`scoreStars(moves, targets)`, explanation from `level.explain(deriveFacts(scene), scene,
match)`), merge stars
and `hintsUsed = max(existing, hintTier)` into progress, add `unlocks` to `unlockedTools`,
save. `requestHint` raises `hintTier` by one up to 3; `hintTier` resets to 0 when the
hint's `stepIndex` changes. Level `n+1` is unlocked once level `n` has `stars[0]`; level 1
always. `resumeLevel` = first unlocked level without `stars[0]`, else the last level.
`selectTool` ignores tools not in the level or not unlocked.

- [ ] **Step 1: Failing tests.**

```ts
test('round-trips progress', …);
test('corrupt JSON → fresh progress and console.warn', …);
test('unknown version → fresh progress', …);
test('storage that throws on get/set → game still works in memory', () => {  // Review Focus 4
  const throwing = { getItem(){ throw new Error('denied') }, setItem(){ throw new Error('quota') } } as unknown as Storage;
  const s = createStore(throwing); s.openLevel('equilateral');
  playReferenceInto(s);                                  // helper: s.apply(...) per step
  expect(s.completion.value).not.toBeNull();
  expect(s.progress.value.levels.equilateral?.stars[0]).toBe(true);
});
test('completing midpoint unlocks perp-bisector and persists it', …);
test('stars merge across attempts', …);
test('coincidental solution never completes', …);
test('hintTier caps at 3 and resets when the target step changes', …);
test('level 2 locked until level 1 completed', …);
test('resumeLevel returns first unsolved unlocked level', …);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: game store and versioned persistence`.

---

### Task 8: Visual foundation — tokens, fonts, base layout, theme toggle

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/base.css`, `src/ui/ThemeToggle.tsx`,
  `src/ui/icons.tsx`
- Modify: `src/main.tsx` (import fonts and CSS; apply `data-theme` from progress)
- Test: `tests/unit/ui/theme.test.tsx` (jsdom)

**Interfaces:**
- Produces CSS custom properties used everywhere: `--bg`, `--grid`, `--ink`,
  `--ink-ghost` (ink at 35%), `--gold`, `--snap`, `--invalid`, `--surface`, `--muted`,
  `--stroke` (1.5px), `--stroke-given` (2px), `--t-draw` (220ms), `--t-ui` (180ms),
  `--t-star` (120ms), `--ease-out` (`cubic-bezier(.2,.7,.2,1)`), `--font-ui`
  (`'Inter Variable'`), `--font-display` (`'Fraunces Variable'`).
- `<ThemeToggle theme={'light'|'dark'|undefined} onChange={(t) => void} />`
- `icons.tsx`: `PointIcon, LineIcon, CircleIcon, PerpBisectorIcon, UndoIcon, RedoIcon,
  ResetIcon, HintIcon, MapIcon, SunIcon, MoonIcon` as 24×24 stroke SVG components.

Theme switching follows the platform guard pattern: tokens on `:root`; dark values under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and again
under `:root[data-theme="dark"]`. `body` sets `background: var(--bg)`. Under
`@media (prefers-reduced-motion: reduce)` set `--t-draw: 80ms` and add a `.no-shimmer`
hook. Values from §6 verbatim.

- [ ] **Step 1: Failing test.** `ThemeToggle` click calls `onChange('dark')` from light and
  sets `aria-label` "Switch to dark theme".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `pnpm build` → 0.
- [ ] **Step 5: Commit** `feat: visual tokens, fonts and theme toggle`.

---

### Task 9: Viewport transforms

**Files:**
- Create: `src/canvas/viewport.ts`
- Test: `tests/unit/canvas/viewport.test.ts`

**Interfaces:**
- Produces: `interface Viewport { cx: number; cy: number; scale: number; width: number;
  height: number }` (world point `(cx,cy)` at screen centre; `scale` px per world unit);
  `toScreen(vp, w: Vec): Vec`; `toWorld(vp, s: Vec): Vec`;
  `zoomAt(vp, screenPt: Vec, factor: number): Viewport` (keeps `screenPt` fixed; clamp
  scale to `[0.25, 8] ×` the fit scale passed as `vp`-independent arg `limits: {min, max}`);
  `panBy(vp, dScreen: Vec): Viewport`;
  `fit(bounds: {x,y,w,h}, width: number, height: number, padding: number): Viewport`;
  `visibleWorldRect(vp): {x,y,w,h}`.

- [ ] **Step 1: Failing tests.** round-trip `toWorld(toScreen(p)) ≈ p`; `zoomAt` keeps the
  anchor; `fit` centres bounds and every corner of `bounds` lands inside the screen minus
  padding, for both 390×844 and 1280×800 (Review Focus 5); zoom clamps.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: viewport transforms`.

---

### Task 10: Candidate intersections and snapping

**Files:**
- Create: `src/canvas/candidates.ts`, `src/canvas/snap.ts`
- Test: `tests/unit/canvas/snap.test.ts`

**Interfaces:**
- Produces:
  - `interface Candidate { a: ObjId; b: ObjId; index: 0 | 1; pos: Vec }`
  - `candidateIntersections(s: Scene): Candidate[]` — every curve pair's intersections,
    excluding any within tol of an existing point and any outside a `segment`/`ray` given's
    extent.
  - `type SnapTarget = { kind: 'point'; id: ObjId; pos: Vec } | { kind: 'candidate'; c:
    Candidate; pos: Vec } | { kind: 'curve'; id: ObjId; t: number; pos: Vec } |
    { kind: 'empty'; pos: Vec }`
  - `type InputKind = 'mouse' | 'pen' | 'touch'`
  - `findSnap(s: Scene, cands: Candidate[], screenPt: Vec, vp: Viewport, input: InputKind,
    accept: Array<SnapTarget['kind']>): SnapTarget | null`
  - `SNAP_RADIUS: Record<InputKind, number>` = `{ mouse: 14, pen: 14, touch: 24 }`

- [ ] **Step 1: Failing tests.**

```ts
test('point beats candidate beats curve when all within radius', …);
test('nearest wins among equal-priority targets', …);
test('touch radius 24 catches a point 20px away; mouse 14 does not', …);
test('candidate coinciding with an existing point is not offered', …);
test('intersection beyond a segment endpoint is not a candidate', …);
test('accept excludes kinds: line tool ignores curves and empty', …);
test('nothing in range and empty not accepted → null', …);
test('hidden given-circle centre is never a point target', …);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Distances measured in screen space via
  `toScreen`; curve distance via `distToCurve` × `vp.scale`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: candidate intersections and snapping`.

---

### Task 11: Gesture state machine

**Files:**
- Create: `src/canvas/gestures.ts`
- Test: `tests/unit/canvas/gestures.test.ts`

**Interfaces:**
- Consumes: `SnapTarget`, `ToolId`, `Command`, `Construction.allocId`.
- Produces:
  - `type GestureState = { mode: 'idle' } | { mode: 'dragging'; from: SnapTarget; current:
    SnapTarget | null; startScreen: Vec } | { mode: 'armed'; from: SnapTarget }`
  - `type GestureEvent = { type: 'down'; target: SnapTarget | null; screen: Vec } |
    { type: 'move'; target: SnapTarget | null; screen: Vec } | { type: 'up'; target:
    SnapTarget | null; screen: Vec } | { type: 'cancel' } | { type: 'tool'; tool: ToolId }`
  - `type GestureEffect = { type: 'commit'; command: Command } | { type: 'invalid' } |
    { type: 'lock'; target: SnapTarget }` (`lock` = snap target changed → pulse + haptic)
  - `gestureReducer(state: GestureState, ev: GestureEvent, ctx: { tool: ToolId; allocId:
    () => ObjId }): { state: GestureState; effects: GestureEffect[] }`
  - `TAP_SLOP_PX = 6`

Rules:
- Two-point tools (`line`, `circle`, `perp-bisector`) accept only `point`/`candidate`
  endpoints. `down` on one starts `dragging`; `up` on a different valid endpoint commits;
  `up` within `TAP_SLOP_PX` of the start with no other target → `armed`; in `armed`, the next
  `down`+`up` on a valid endpoint commits. An endpoint that is a `candidate` adds its
  `intersection` object first in the same command.
- `point` tool: `up` on `empty` → `free-point`; on `curve` → `on-curve`; on `candidate` →
  `intersection`; on an existing `point` → no effect.
- With any tool, a tap on a `candidate` while idle commits that `intersection`; for
  two-point tools it also arms it as the first endpoint.
- Same endpoint twice → `invalid`. `up` on nothing/empty with a two-point tool while
  dragging → back to `idle`, no commit. `cancel` from any state → `idle`, no effects.
  `tool` resets to `idle`.

- [ ] **Step 1: Failing tests.**

```ts
test('drag A→B with circle tool commits circle(center A, through B)', …);
test('tap A then tap B with line tool commits line A–B', …);
test('drag from point to candidate commits intersection + line in one command', …);
test('release on same point → invalid', …);
test('release over empty space with line tool → idle, nothing committed', …);   // Review Focus 1
test('cancel mid-drag → idle, nothing committed', …);                           // Review Focus 1, 2
test('point tool on curve → on-curve with t from target', …);
test('tap on candidate with circle tool commits intersection and arms it', …);
test('moving onto a new snap target emits lock once', …);
test('changing tool while armed → idle', …);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: gesture state machine`.

---

### Task 12: SVG canvas, rendering, animation and magnifier

**Files:**
- Create: `src/canvas/shapes.ts`, `src/canvas/SceneLayer.tsx`, `src/canvas/Canvas.tsx`,
  `src/canvas/Magnifier.tsx`
- Test: `tests/unit/canvas/shapes.test.ts`, `tests/unit/canvas/SceneLayer.test.tsx` (jsdom)

**Interfaces:**
- Consumes: store (Task 7), viewport, snap, gestures, `describe`.
- Produces:
  - `linePath(l: LineG, rect, extent?: {from: Vec; to?: Vec})` → `{x1,y1,x2,y2}` clipped to
    `rect` (segment/ray honour extent; a player line starts its sweep at its first point)
  - `circlePath(c: CircleG, start: Vec): string` — two-arc SVG path beginning at `start`
    (the radius point), so the draw-on traces from there
  - `<Canvas store={Store} />`: owns the `Viewport` (fit on mount and on resize until the
    player zooms/pans — then keep their view), pointer capture, gesture reducer, pinch/pan,
    wheel zoom, double-tap fit, keyboard.
  - `<SceneLayer scene highlight ghost snap goldMatch hintIds animating />`
  - `<Magnifier />` — visible only during a touch drag

Rendering contract (E2E tests rely on these attributes):
- Each point: `<g data-kind="point" data-id data-label role="button" tabindex="0"
  aria-label="Point A">` with a 4 px visible dot and a transparent hit circle.
- Each curve: `data-kind="line"|"circle"`, `data-id`.
- Candidates: `data-kind="candidate"`, faint 3 px dots at 50% opacity of `--ink`.
- Ghost: `data-kind="ghost"` at `--ink-ghost`; locking onto a target applies a 120 ms
  scale pulse class; snap target drawn in `--snap` and enlarged ×1.4.
- Invalid effect: ghost gets a 240 ms horizontal shake class, then clears.
- Draw-on: new curves use `pathLength="1"` and animate `stroke-dashoffset` 1 → 0 over
  `--t-draw`; undo plays the same animation reversed on a retained copy, which is removed
  on `animationend` (or immediately under reduced motion). Duplicate → pulse the existing
  object (`ApplyResult.existingId`).
- Grid: SVG `<pattern>` dot grid in `--grid`; its opacity eases to 0 as
  `scale` drops below half the fit scale. All strokes use `vector-effect: non-scaling-stroke`.
- Live region: `<div aria-live="polite" class="sr-only">` announces `describe()` of each
  committed object.
- Haptics: on `lock` during touch, call `navigator.vibrate?.(8)`.
- Multi-pointer: a second active pointer dispatches `cancel` to the reducer and starts
  pinch/pan (Review Focus 2). Space+drag and two-finger drag pan; wheel zooms at the
  cursor; double-click/double-tap on empty fits.
- Magnifier: 96 px circle, 2× zoom, centred 72 px above the touch point (flipped below when
  near the top edge), showing the scene, ghost and snap via a second `<svg>` using a
  `<use href="#scene-root">`.

- [ ] **Step 1: Failing tests.** `linePath` clips a horizontal line to the rect; segment
  extent stays between endpoints; ray starts at its vertex; `circlePath` begins with
  `M start`. `SceneLayer` renders `[data-label="A"]` with `aria-label="Point A"`, renders
  one `[data-kind="candidate"]` for two crossing circles' two crossings (=2 elements), and
  renders no `ghost` when `ghost` is null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Render temporarily via a bare
  `GameScreen` stub in `main.tsx` that mounts `<Canvas>` for level 1.
- [ ] **Step 4: Run** unit tests → PASS. Then `pnpm dev`, open in Playwright (or a quick
  script) at 1280×800 and at 390×844 with touch emulation; draw two circles and a line;
  save screenshots to the scratchpad and review: crisp strokes, visible snap highlight,
  magnifier on touch.
- [ ] **Step 5: Commit** `feat: SVG canvas with snapping, draw-on animation and magnifier`.

---

### Task 13: Game screen — top bar, tool palette, undo/redo/reset, keyboard

**Files:**
- Create: `src/ui/GameScreen.tsx`, `src/ui/TopBar.tsx`, `src/ui/ToolPalette.tsx`,
  `src/ui/App.tsx`
- Modify: `src/main.tsx` (mount `<App/>`)
- Test: `tests/unit/ui/GameScreen.test.tsx` (jsdom)

**Interfaces:**
- Consumes: store, `Canvas`, `icons`.
- Produces: `<App store />` routes by `store.screen`; `<GameScreen store />`;
  `<TopBar level moves targets onHint onMap />`;
  `<ToolPalette tools active onSelect canUndo canRedo onUndo onRedo onReset />`.

Details:
- Top bar: level number + title in `--font-display`, goal text, counter text exactly
  `L {L}/{targetL} · E {E}/{targetE}`; a counter part gets class `over` (colour `--muted`)
  when exceeded.
- Palette: tools in order point, line, circle, perp-bisector (only those in the level and
  unlocked); `aria-pressed` on the active tool; key hints 1–4; undo/redo/reset buttons with
  accessible names "Undo", "Redo", "Reset". Bottom bar below 768 px, left rail at or above.
- Keyboard: `1–4` select the n-th available tool; `⌘/Ctrl+Z` undo; `⇧⌘Z` / `Ctrl+Y` redo;
  `Esc` → gesture `cancel`. Shortcuts are ignored while focus is in an input.
- Default tool on level open: `circle` if available, else first.

- [ ] **Step 1: Failing tests.** Counter reads `L 0/4 · E 0/4` on level 1; pressing `2`
  selects line (`aria-pressed="true"`); `Ctrl+Z` after an apply restores `L 0/4`; level 1
  palette has no "Perpendicular bisector" button; level 4 (with unlocked tool) has it.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; check both
  breakpoints visually in the dev server.
- [ ] **Step 5: Commit** `feat: game screen with top bar, tool palette and shortcuts`.

---

### Task 14: Hints panel, completion card and tool unlock reveal

**Files:**
- Create: `src/ui/HintPanel.tsx`, `src/ui/CompletionCard.tsx`
- Modify: `src/ui/GameScreen.tsx`, `src/canvas/SceneLayer.tsx` (hint highlight + ghost,
  gold goal draw-on), `src/ui/ToolPalette.tsx` (reveal)
- Test: `tests/unit/ui/HintPanel.test.tsx`, `tests/unit/ui/CompletionCard.test.tsx`

**Interfaces:**
- `<HintPanel hint tier onMore onClose />`: tier 1 shows `hint.nudge`; tier 2 adds button
  state "Show me where" and the canvas glows `hint.inputIds` in `--snap`; tier 3 ("Show the
  next step") draws `hint.ghost` as a dashed `--gold` ghost. Button "More help" advances
  tiers; hidden at tier 3.
- `<CompletionCard stars explanation unlocked onNext onReplay onMap />`: slides up
  (transform, `--t-ui`); stars fill one by one 120 ms apart after the gold draw-on
  (220 ms); shows `explanation`; buttons "Next", "Replay", "Map" (no "Next" on level 6 —
  show "Map" as primary). If `unlocked`, shows "New tool: Perpendicular Bisector".
- On completion: matched goal objects re-stroke in `--gold` with draw-on, then a radial
  shimmer (skipped under reduced motion), then the card.
- Tool reveal: when `perp-bisector` first appears in the palette, it scales in from 0.6
  with a gold ring and shows the one-time tip from the level (`tip` on level 4:
  "New tool: drag between two points to draw their perpendicular bisector.").

- [ ] **Step 1: Failing tests.** HintPanel tier 1 shows the exact nudge and "More help";
  tier 3 hides "More help". CompletionCard with `[true,false,true]` renders 3 star elements,
  2 with `data-earned="true"`; level 6 has no "Next" button; `unlocked` renders the
  new-tool line.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: tiered hints, completion card and tool reveal`.

---

### Task 15: Title screen, level map and resume

**Files:**
- Create: `src/ui/TitleScreen.tsx`, `src/ui/LevelMap.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/unit/ui/LevelMap.test.tsx`

**Interfaces:**
- `<TitleScreen hasProgress onStart />`: "Apollonius" in `--font-display`, subtitle
  "Compass & straightedge puzzles", one button: "Begin" (no progress → opens level 1) or
  "Continue" (→ `resumeLevel()`). The title's underline draws on as a construction arc.
- `<LevelMap levels progress isUnlocked onOpen />`: six nodes placed along one circular arc
  (drawn with the same draw-on as constructions), each with its number, title, and three
  stars; locked nodes at 40% opacity, not focusable, `aria-disabled="true"`.

- [ ] **Step 1: Failing tests.** Map renders 6 nodes; with only level 1 solved, nodes 1–2
  are enabled and 3–6 disabled; node 1 shows earned stars from progress; clicking an
  enabled node calls `onOpen(id)`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: title screen and level map`.

---

### Task 16: Level 1 tutorial coach marks and inline tips

**Files:**
- Create: `src/ui/CoachMark.tsx`
- Modify: `src/levels/l1-equilateral.ts` (add `coach`), `src/levels/l4-perpendicular.ts`
  and `l6-circle-center.ts` (`tip`), `src/ui/GameScreen.tsx`
- Test: `tests/unit/levels/coach.test.ts`, `tests/unit/ui/CoachMark.test.tsx`

Coach sequence for level 1 (exact copy; `target` ids pulse):
1. `"Drag from A to B to draw a circle."` → done when a circle centred at A through B exists.
2. `"Now drag from B to A."` → done when circle B→A exists.
3. `"Tap where the circles cross."` → done when a point at either intersection exists.
4. `"Draw lines from your new point to A and to B."` (tool switches to line on entry)
   → done when the goal is met.

Each mark shows the current step only; it fades (`--t-ui`) when `doneWhen` becomes true and
the next appears. Wrong actions leave the mark in place. Level 6 tip: `"Tap the circle to
place points on it."` Tips show once per level (tracked in memory for the session; no new
persisted fields).

- [ ] **Step 1: Failing tests.** Each `doneWhen` is false on the givens and true after the
  matching reference step (`coach.test.ts`). CoachMark renders text and `role="status"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: level 1 tutorial and inline tips`.

---

### Task 17: Keyboard construction and accessibility pass

**Files:**
- Modify: `src/canvas/Canvas.tsx`, `src/canvas/SceneLayer.tsx`, `src/styles/base.css`
- Test: `tests/unit/ui/a11y.test.tsx` (jsdom)

Requirements (§5.7): Tab/Shift+Tab move focus through points in scene order; focused point
shows the `--snap` ring; `Enter` on a focused point dispatches `down`+`up` with that point
as target (so two Enters on two points commit a two-point tool); `Esc` cancels. All
buttons have accessible names; the live region announces commits; reduced motion shortens
draw-on to 80 ms fades and disables shimmer and pulse; colour is never the only signal
(earned stars also differ in fill shape, snap targets enlarge).

- [ ] **Step 1: Failing tests.** With circle tool: focus A, Enter, focus B, Enter →
  `construction.moves().L === 1` and live region text `"Circle centered at A through B"`.
  `Esc` after the first Enter → no commit.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: keyboard construction and accessibility`.

---

### Task 18: End-to-end tests and visual review

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/play.spec.ts`,
  `tests/e2e/progress.spec.ts`, `tests/e2e/screens.spec.ts`

**Interfaces:**
- `helpers.ts`: `pointCenter(page, label): Promise<{x,y}>` (bounding-box centre of
  `[data-kind="point"][data-label="…"]`); `drag(page, from, to, input: 'mouse' | 'touch')`
  (touch uses CDP `Input.dispatchTouchEvent`); `tap(page, pt, input)`;
  `candidates(page)`; `selectTool(page, n)`.
- Config: `webServer` runs `pnpm build && pnpm vite preview --port 4173`; projects
  `desktop` (1280×800, mouse) and `mobile` (390×844, `hasTouch`, `isMobile`).
  Browsers come from `PLAYWRIGHT_BROWSERS_PATH`; `@playwright/test@1.56.1` matches the
  installed chromium-1194 — if it ever doesn't, set
  `use.launchOptions.executablePath` instead of downloading.

Tests:
- [ ] **Step 1: Write the specs.**
  - `play.spec`: solve level 1 via the coach flow (drag A→B, B→A, tap candidate, two
    lines) on both projects → completion card visible with 3 earned stars and the exact
    level 1 explanation. Undo/redo/reset change the counter as expected. Rapid undo right
    after a commit → after 400 ms no `[data-kind="circle"]` remains (Review Focus 3).
    Each hint tier: tier 1 text, tier 2 glow class on A and B, tier 3 one `[data-kind=
    "hint-ghost"]`. Pinch start during a drag (two touch points) commits nothing (Review
    Focus 2). Reduced motion (`page.emulateMedia({ reducedMotion: 'reduce' })`) still
    completes level 1.
  - `progress.spec`: solve levels 1–3 by reference steps → map shows 3 solved; reload →
    still solved and level 4 palette shows "Perpendicular bisector"; then solve level 4
    with the tool in 2 moves → ★★ and ★★★ earned. Resize desktop → 390×844 mid-level: all
    givens' centres lie within the viewport and the palette is at the bottom (Review
    Focus 5).
  - `screens.spec`: screenshots of title, map, level 1 mid-construction, hint tier 3,
    completion card — in light and dark — to `test-results/screens/`.
- [ ] **Step 2: Run** `pnpm e2e` → expect failures to point at real gaps; fix them in the
  owning module (not in tests), re-run until PASS on both projects.
- [ ] **Step 3: Visual review.** Open every screenshot; check against §6 (colours, stroke
  weights, type, spacing, alignment at both sizes) and §5.5 layout. Fix and re-shoot until
  nothing looks off.
- [ ] **Step 4: Full verification.** `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
  && pnpm build` → all exit 0.
- [ ] **Step 5: Commit** `test: end-to-end play, progress and visual screenshots`.

---

## Spec Coverage Map

| Spec | Tasks |
|---|---|
| §2 robustness, fact layer | 4, 5 |
| §3 flows 1–5 | 15, 13, 14, 7/14, 7/15 |
| §4.1 tools & costs | 2, 11, 13 |
| §4.2 levels & targets | 3 |
| §4.3 stars | 5, 7, 14 |
| §5.1 constructing, duplicates, invalid | 2, 11, 12 |
| §5.2 snapping, magnifier | 10, 12 |
| §5.3 canvas, live goal check | 9, 12, 7 |
| §5.4 undo/redo/reset | 2, 12, 13 |
| §5.5 layout & feedback | 13, 14 |
| §5.6 tutorial & tips | 16, 14 |
| §5.7 accessibility | 12, 17 |
| §6 visual direction | 8, 12, 14, 15, 18 |
| §7.1–7.5 architecture, errors | 1–7 |
| §8 testing | every task; 18 |
| §9 tooling | 1, 18 |
