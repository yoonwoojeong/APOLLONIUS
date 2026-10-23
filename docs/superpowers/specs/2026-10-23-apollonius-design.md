# Apollonius — Design Spec

**Date:** 2026-10-23
**Status:** Draft for review
**Scope:** MVP vertical slice (6 levels)

## 1. Intent

Apollonius is a geometry construction puzzle game inspired by Euclidea. Players solve
compass-and-straightedge construction problems on a precise, tactile canvas.

**Audience:** general puzzle fans, playing on desktop (mouse/trackpad) and mobile (touch)
with equal quality. Responsive web app.

**Primary priority:** UI/UX. An elegant, minimalist interface where constructing feels
natural and satisfying. A small, exceptionally polished vertical slice beats feature breadth.

**Success criteria for the MVP:**

1. A new player can open the app and complete Level 1 with no instructions beyond the
   in-canvas tutorial.
2. All six levels are solvable with mouse and with touch; snapping never commits an
   object the player did not intend (verified by E2E tests on both input modes).
3. Any geometrically valid solution is accepted, not only the reference one; coincidental
   (non-general) solutions are rejected.
4. Hints help a stuck player progress without revealing the whole solution at once.
5. Progress (stars, unlocked tools) survives a reload.
6. Every interaction has visible feedback within one frame; animations respect
   `prefers-reduced-motion`.

**Assumptions (confirmed during brainstorming):** static web app, no backend, no accounts,
English only, progress in `localStorage`, no sound in the MVP.

## 2. Decision: AlphaGeometry vs. a custom engine

AlphaGeometry (DeepMind) proves olympiad *theorems* using a neural language model that
proposes auxiliary constructions plus a symbolic deduction engine (DDAR). It is not a
solver for move-bounded construction puzzles, requires a Python/JAX stack with large model
weights, and solves in seconds to minutes. It cannot run in the browser and would require
a server for no gameplay benefit.

**Decision:** do not integrate AlphaGeometry. Build a small TypeScript geometry engine and
borrow two of its ideas where they help gameplay:

- **Numeric robustness checking** (AlphaGeometry verifies candidate facts numerically before
  proving them): we re-run the player's construction on randomly perturbed givens to reject
  solutions that only work by coincidence.
- **A lightweight deduction layer** in the spirit of DDAR: a small set of facts
  (equidistance, incidence, perpendicularity) used to phrase hints and explain *why* a
  solution works, in plain language.

Alternatives rejected: JSXGraph/GeoGebra embeds (hard to make feel tactile; we would fight
their UX conventions), server-side AlphaGeometry (latency, hosting cost, poor fit).

## 3. Core user flows

1. **First launch** — quiet title screen → straight into Level 1 (tutorial). No menu stands
   between the player and the first construction.
2. **Play a level** — read the goal → pick a tool → construct with live feedback →
   goal met (celebration + stars) or use undo/redo/reset/hint.
3. **Get a hint** — tiered: nudge (text) → highlight (relevant objects glow) → ghost (preview
   of the next step).
4. **Progress** — level map with stars; completing Level 3 unlocks the Perpendicular
   Bisector tool with a reveal animation.
5. **Return** — resume at the furthest unlocked level; replay any level to improve stars.

## 4. Content

### 4.1 Tools

| Tool | Gesture | Move cost |
|---|---|---|
| Point | Tap empty space or a curve | free |
| Line | Drag point→point (or tap A, tap B) | 1 L, 1 E |
| Circle | Drag center→radius point (or tap, tap) | 1 L, 1 E |
| Perpendicular Bisector (earned) | Drag point→point (or tap, tap) | 1 L, 3 E |

**L** counts tool uses. **E** counts elementary compass/straightedge operations; earned
tools count as their elementary expansion. Points and intersections are free.
Intersections are not a separate tool: candidate intersection dots can be tapped with
any tool active (see 5.1).

### 4.2 Levels

| # | Name | Givens | Goal | L | E |
|---|---|---|---|---|---|
| 1 | Equilateral Triangle (tutorial) | Segment AB | Lines AC, BC for some C making ABC equilateral | 4 | 4 |
| 2 | Perpendicular Bisector | Points A, B | The perpendicular bisector line of AB | 3 | 3 |
| 3 | Midpoint | Segment AB | Point M, the midpoint of AB | 3 | 3 |
| 4 | Perpendicular at a Point | Line ℓ through points A, P | Line through P perpendicular to ℓ | 2 | 4 |
| 5 | Angle Bisector | Rays VA, VB | Bisector line of angle AVB | 2 | 4 |
| 6 | Circle Center | Circle (center hidden) | Point at the circle's center | 2 | 6 |

Completing Level 3 unlocks the Perpendicular Bisector tool (available in Levels 4–6).

L/E targets are provisional. Each must be validated by a reference solution in the test
suite, and adjusted if a shorter valid solution is found.

### 4.3 Stars

- ★ — goal reached.
- ★★ — goal reached within the L target.
- ★★★ — goal reached within the E target.

Stars are independent (a player can earn ★ and ★★★ without ★★). The best result for each
star is kept across attempts. Hints never cost stars; using tier 2/3 hints is recorded but
not penalized.

## 5. Interaction design

### 5.1 Constructing

- **Line / Circle / Perp. Bisector:** press on a point, drag, release on a second point.
  The fallback is tap-then-tap. While dragging, a ghost preview (35% opacity) follows the
  pointer and *locks* onto the snap target with a small scale pulse (and
  `navigator.vibrate(8)` where supported).
- **Point:** tap empty space for a free point; tap a curve for a point on it. Free points
  store their position as a parameter (absolute coordinates or a curve parameter) so the
  robustness check can re-place them on perturbed givens.
- **Intersections:** when two curves cross, faint candidate dots appear at the crossings.
  Tapping one makes it a solid point. Line/circle gestures may also start or end directly
  on a candidate dot, which implicitly creates that intersection point.
- **Duplicates:** drawing an object geometrically equal to an existing one does not count
  as a move; the existing object pulses briefly.
- **Invalid actions** (e.g. a line from a point to itself): gentle horizontal shake of the
  ghost, no modal or error text.

### 5.2 Precision and snapping

- Snap radius: 14 px (mouse/pen), 24 px (touch), in screen space.
- Priority when several targets are in range: existing point > candidate intersection >
  curve > empty space. Ties go to the nearest.
- The current snap target is highlighted (soft blue) *before* release.
- **Touch magnifier:** during a touch drag, a circular loupe (2× zoom, ~96 px) appears
  offset above the finger, showing the snap target and the ghost.

### 5.3 Canvas

- Pinch or scroll wheel to zoom (centered on pointer); two-finger drag or space+drag to pan.
  Double-tap / double-click empty space fits the construction to the viewport.
- Construction is fixed. Objects do not move once placed (Euclidea-style).
- The goal is checked live after every command and gives no signal until it is met. Then
  the goal object draws on in gold and the completion card slides up.

### 5.4 Undo / redo / reset

- Unlimited undo/redo via toolbar buttons, ⌘/Ctrl+Z, and ⇧⌘Z / Ctrl+Y.
- Undo reverses the step's draw-on animation; redo replays it.
- Reset clears the level's construction and is itself one undoable step.

### 5.5 Layout and feedback

- **Top bar:** level name, one-line goal statement, move counter ("L 2/3 · E 2/3"); a counter
  turns muted when its target is exceeded.
- **Tool palette:** bottom on narrow screens (<768 px), left side on wider screens. Clear
  active state. A newly earned tool arrives with a reveal animation and a one-time tip.
- **Hint button** (lightbulb) in the top bar opens the hint panel.
- **Completion card:** stars fill one by one, a one-sentence "why it works" explanation from
  the reasoning layer, and buttons for Next, Replay, and Map.

### 5.6 Tutorial

- Level 1 runs a coach-mark sequence: a pulsing target plus a short caption for each step
  ("Drag from A to B to draw a circle"). Each coach mark fades as soon as the player
  completes the action. Wrong actions are allowed; the coach mark simply stays.
- Later levels show at most one inline tip the first time a concept appears (the earned
  tool in Level 4; placing points on a curve in Level 6).

### 5.7 Accessibility

- Keyboard: number keys 1–4 select tools; Tab/Shift+Tab cycles snappable points; Enter
  selects the focused point as a gesture endpoint; Esc cancels the current gesture.
- Colorblind-safe semantics: color is never the only signal (success also uses motion and
  the stars; snap targets also enlarge).
- `prefers-reduced-motion`: draw-on animations become 80 ms fades; no shimmer.
- Interface controls have accessible names. The canvas has a live region announcing
  created objects ("Circle centered at A through B").

## 6. Visual direction

**Theme: "drafting paper at dusk".** Quiet, precise, the geometry is the ornament.

| Token | Light | Dark |
|---|---|---|
| Background | `#F7F4EE` + faint dot grid | `#14171F` + faint dot grid |
| Construction ink | `#2B2B30`, 1.5 px | `#E8E6E1`, 1.5 px |
| Given objects | ink, 2 px | ink, 2 px |
| Goal / success | `#D9A441` | `#E2B457` |
| Snap / selection | `#4A7BD0` | `#7AA2E8` |
| Invalid | `#C0584F` (shake only) | `#D9776E` |
| Ghost preview | ink at 35% | ink at 35% |

- The dot grid fades out as the player zooms out. Stroke widths stay constant in screen
  space regardless of zoom.
- Typography: *Inter* for interface text; *Fraunces* for level titles and the title screen.
  Both are self-hosted (no runtime CDN dependency).
- Motion: object draw-on 220 ms ease-out (lines sweep from the first point, circles trace
  from the radius point); interface transitions 150–200 ms; the snap pulse is the only
  springy motion. Completion: gold draw-on of the goal object → soft radial shimmer →
  stars fill one by one (120 ms apart).
- Theme follows `prefers-color-scheme`, with a manual toggle stored in `localStorage`.
- **Level map:** six nodes on a single arc drawn as a construction (an Apollonian nod).
  Each node shows its earned stars; locked nodes are dimmed.

## 7. Architecture

Each part has one purpose and dependencies point one way: `ui → canvas → state →
reasoning/levels → construction → geometry`.

```
src/
  geometry/      Pure math, no DOM. Vec, Line, Circle; intersections (line-line,
                 line-circle, circle-circle); distance/equality with tolerance.
  construction/  Construction graph. Objects reference their parents by id and are
                 recomputed from givens. Commands (AddPoint, AddLine, AddCircle,
                 AddPerpBisector, AddIntersection, Reset). Undo/redo history.
                 Move counting (L/E). Duplicate detection.
  levels/        Level definitions as data: givens, goal predicate, L/E targets,
                 reference solution (a command list), authored nudge texts, unlocks.
  reasoning/     Robustness check, fact derivation, hint engine, "why it works" text.
  canvas/        SVG renderer, viewport (pan/zoom), hit-testing and snapping,
                 gesture state machine (mouse/touch/pen/keyboard), magnifier,
                 draw-on animations.
  state/         Game store: current level, active tool, construction, hint tier,
                 progress. Persistence (versioned localStorage).
  ui/            Preact components: TitleScreen, LevelMap, TopBar, ToolPalette,
                 HintPanel, CompletionCard, CoachMark, ThemeToggle.
```

### 7.1 Construction model

- Every object has an `id`, a `kind`, its parent ids, and a cached geometric value computed
  from its parents. Givens have no parents. Free points store their parameter.
- The construction is the ordered list of applied commands. The graph can be rebuilt from
  any set of given values, which is how the robustness check re-runs a construction.
- Undo/redo moves a cursor over the command list. A new command truncates the redo tail.

### 7.2 Goal checking

- Each level supplies a goal predicate over the current construction, e.g. "there exists a
  line equal to the perpendicular bisector of A and B". Equality uses a scene-scaled
  tolerance (1e-9 × scene diameter).
- Because the predicate tests geometric facts rather than specific steps, any valid
  construction is accepted.
- **Robustness:** when the predicate first passes, the construction is rebuilt on 5 random
  perturbations of the givens (each given point moved by up to 10% of the scene size; free
  points keep their parameters). The level completes only if the predicate holds on all of
  them. This rejects solutions that only work by coincidence. Cost: well under 1 ms per
  check for these construction sizes.

### 7.3 Reasoning and hints

- **Fact layer:** derives a small set of facts from the construction graph: point on circle
  ⇒ distance equals radius; two circles of equal radius with a shared point; point equidistant
  from A and B ⇒ on their perpendicular bisector; perpendicularity from the perpendicular
  bisector. These facts produce the completion card's explanation (e.g. "C lies on both
  circles, so CA = AB = CB").
- **Progress matching:** to recognize equivalent progress, the hint engine compares the
  player's objects to the reference solution's objects by geometric equality, not by step
  order. The next hint targets the first reference step whose result does not yet exist
  and whose inputs do.
- **Hint tiers:**
  1. *Nudge:* authored text for that reference step (e.g. "Which points are the same
     distance from A and from B?").
  2. *Highlight:* the input objects of that step glow.
  3. *Ghost:* the step's result is drawn as a ghost preview, which the player can trace.
- If the player's construction contains nothing usable from the reference (they took a
  different path), the hint engine falls back to the reference step whose inputs are
  available among the givens, and the nudge says "Try starting from the given points".

### 7.4 State and persistence

- A single store (Preact signals) holds UI state. Construction state lives in the
  construction module; the store holds a reference to it and a revision counter that
  triggers re-renders.
- Persisted data: `{ version: 1, levels: { [id]: { stars: [bool, bool, bool], hintsUsed:
  number } }, unlockedTools: string[], theme?: 'light' | 'dark' }` under the key
  `apollonius:v1`.

### 7.5 Error handling

- Degenerate geometry (parallel lines, non-intersecting circles, zero-radius circles)
  returns `null` from geometry functions and is never thrown. Commands that would create
  degenerate objects are rejected with the invalid-action shake.
- If a dependent object becomes undefined on a perturbed rebuild, that perturbation counts
  as a failure for the robustness check.
- Corrupt or unknown-version save data is discarded with a console warning; the game starts
  fresh. `localStorage` access is wrapped in try/catch (private mode).

## 8. Testing

- **Unit (Vitest):**
  - geometry: every intersection kind, including tangency and degenerate cases;
  - construction: command apply/undo/redo, duplicate detection, L/E counting, rebuild on new
    givens;
  - levels: every reference solution passes its goal and meets its L/E targets; crafted
    near-miss constructions fail; a coincidental solution fails the robustness check;
  - reasoning: progress matching from partial and alternative constructions; explanation
    text for each level;
  - persistence: round-trip, corrupt data, version mismatch.
- **E2E (Playwright, Chromium):** solve Level 1 with mouse and with touch emulation;
  undo/redo/reset; each hint tier; unlock after Level 3 persists across reload; reduced
  motion. Screenshots of key screens in light and dark themes, captured for visual review.
- **Fast checks:** `tsc --noEmit`, ESLint, Vitest on every change.

## 9. Tooling

Vite, TypeScript (strict), Preact (+ `@preact/signals`), Vitest, Playwright, ESLint,
Prettier. pnpm. Output is a static site (`dist/`) that can be hosted anywhere.

## 10. Out of scope for the MVP

Sound and music; more than six levels or a second pack; level editor; accounts, cloud
save, leaderboards; localization; additional earned tools (perpendicular, parallel,
compass-transfer); dragging givens after construction; a PWA/offline install.
