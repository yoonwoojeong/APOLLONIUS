# Marketing footage

`record.mjs` records the gameplay clips for the 30-second vertical (9:16, 1080×1920) promo.

```sh
pnpm build
node marketing/record.mjs            # all clips
node marketing/record.mjs snap hints # just some: level1, snap, hints, tool, title
```

It uses a preview already running at `$APOLLONIUS_URL` (default `http://localhost:4173`), or
starts `pnpm vite preview` on `dist/` itself and stops it afterwards. Needs Playwright's
Chromium (headless shell) and `ffmpeg` on the `PATH`.

Output goes to `marketing/out/` (git-ignored):

| File | Content |
| --- | --- |
| `01-hook.mp4` | Level 1, a still beat on A and B, then the first circle A→B |
| `02-solve.mp4` | Continues 01: circle B→A, upper crossing, lines to A and B, gold, stars, card |
| `03-snap.mp4` | Slow touch drag with the loupe, locking onto B; solved via the lower apex |
| `04-hints.mp4` | Level 2 mid-way: Hint → nudge, More help → glow, More help → ghost |
| `05-tool.mp4` | Level 4 right after the unlock: bisector reveal + tip, then one bisector A→P |
| `06-endcard-bg.mp4` | Fresh title screen with the arc underline drawing in |
| `poster.png` | 1080×1920 still of the Level 1 completion |

How it works: a 360×640 CSS-px window at a forced device scale factor of 3 (headless shell
flags; Playwright viewport emulation would cap the screencast at CSS pixels), touch emulation
over CDP, and frames from `Page.startScreencast` saved with their timestamps. Each clip is
turned into a constant 30 fps H.264 MP4 (yuv420p, CRF 16) through an ffconcat list with the
real per-frame durations, so motion plays at real-time speed. Gestures are real CDP touch
events with eased moves, so the magnifier shows during drags. Progress is seeded in
`localStorage['apollonius:v1']` (light theme; Level 1 marked solved to hide its coach).

Set `KEEP_FRAMES=1` to keep the raw PNG frames in `marketing/out/frames/`.

## Voiceover and final cut

The voiceover is ElevenLabs text-to-speech (model `eleven_v4`, voice "Justin Case – Warm,
Trustworthy, Clear"), generated in the ElevenLabs Flow "Apollonius — 30s vertical promo".
Download the chosen take as `marketing/out/voiceover.mp3`. Script:

> Can you draw a perfect triangle... with only a compass and a ruler?
> Apollonius turns twenty-three centuries of geometry into a puzzle at your fingertips.
> Drag to draw. Tap where curves cross. Any valid construction counts.
> Stuck? Gentle hints show the way — and every level you master earns new tools.
> Apollonius. Free, in your browser.

Then:

```sh
marketing/assemble.sh   # → marketing/out/apollonius-30s-9x16.mp4
```

`assemble.sh` holds the edit decision list (which part of each clip plays, and how fast), delays
the voiceover by 0.3 s, normalises loudness to −14 LUFS and burns in `captions.ass`, whose
phrase timings match the pauses in the take. A new take or new clips mean re-timing both: find
the pauses with
`ffmpeg -i marketing/out/voiceover.mp3 -af silencedetect=noise=-35dB:d=0.25 -f null -`.
Captions use the system font Inter (SemiBold/Medium).
