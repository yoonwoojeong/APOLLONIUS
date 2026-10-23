# Apollonius

[![CI and deploy](https://github.com/yoonwoojeong/APOLLONIUS/actions/workflows/deploy.yml/badge.svg)](https://github.com/yoonwoojeong/APOLLONIUS/actions/workflows/deploy.yml)

**Play:** https://yoonwoojeong.github.io/APOLLONIUS/

Apollonius is a compass-and-straightedge geometry puzzle game for the browser, inspired by
Euclidea. Across six levels you construct an equilateral triangle, perpendicular bisectors,
midpoints, perpendiculars, angle bisectors and a circle's centre using only lines, circles and
their crossings. Any valid construction is accepted, and stars reward doing it in few moves.

It plays equally with a mouse or by touch, saves progress locally and needs no backend.

## Requirements

- Node 22
- pnpm

## Scripts

```sh
pnpm install      # install dependencies
pnpm dev          # start the Vite dev server
pnpm test         # unit tests (Vitest)
pnpm typecheck    # TypeScript, no emit
pnpm lint         # ESLint
pnpm e2e          # end-to-end tests (Playwright; builds and serves the app itself)
pnpm build        # typecheck and build the static site into dist/
pnpm vite preview # serve the built dist/ locally
```

`pnpm e2e` needs Playwright's Chromium. Install it once with `pnpm exec playwright install
chromium` (this repository's development environment already provides it).

## Deploying

`dist/` is a fully static site with relative asset URLs and self-hosted fonts, so it can be
served from any host and any path (for example `https://example.com/games/apollonius/`).

The `CI and deploy` workflow (`.github/workflows/deploy.yml`) runs typecheck, lint, unit tests,
end-to-end tests and the build on every pull request and push. Pushes to `main` that pass are
published to GitHub Pages. One-time setup: in the repository's Settings → Pages, set
**Source** to **GitHub Actions**.

## Project structure

- `src/geometry/` — vectors, curves, intersections and tolerances
- `src/construction/` — the construction model: objects, commands, undo/redo, move counts
- `src/levels/` — the six levels: givens, goals, reference solutions, explanations
- `src/reasoning/` — facts, hints, robustness checks and star scoring
- `src/state/` — the game store and versioned local persistence
- `src/canvas/` — the SVG canvas: viewport, snapping, gestures, animation, magnifier
- `src/ui/` — screens and controls: title, level map, game screen, hints, completion card
- `src/styles/` — design tokens and base styles
- `tests/unit/`, `tests/e2e/` — Vitest and Playwright tests

## Design docs

The design spec is in `docs/superpowers/specs/` and the implementation plan in
`docs/superpowers/plans/`.
