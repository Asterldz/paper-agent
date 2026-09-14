# Pet sprite animation — v4

The launcher now uses five transparent WebP atlases, with 68 frame cells in total:

| Action | Asset | Frames | Behavior |
| --- | --- | --- | --- |
| Idle | `public/cat-v4-idle.webp` | 12 | Blink / tail, loop |
| Thinking | `public/cat-v4-thinking.webp` | 16 | Paw to chin / gaze, loop |
| Click | `public/cat-v4-hello.webp` | 16 | Wave, one-shot |
| Drag | `public/cat-v4-carried.webp` | 12 | Hanging limbs / kicking, loop |
| Drop | `public/cat-v4-landing.webp` | 12 | Feet down / settle, one-shot |

The eyes, paws, ears, tail and legs change between drawings. No whole-image wobble transform is used to simulate the action. Header/message avatars remain still to avoid distracting from reading. Frame holds are mostly 70–180 ms, with longer idle rests: this is roughly 6–14 pose updates/second during movement, **not 60 unique drawings/second**. Some generated intermediate drawings are visually similar; frame-count tests do not prove visual smoothness.

`petAnimation.ts` owns frame sequences, durations and normalized source rectangles. Uneven generated rows have explicit boundaries. `PetSprite.tsx` draws only the selected source region into a small high-DPI canvas (device pixel ratio capped at 3). Aspect ratio and scale stay constant within each action, with bottom alignment. This avoids stretching shorter poses to fill a square or cutting a tall landing pose with a uniform grid.

Only the next frame is scheduled; React does not re-render per frame. Timers/listeners are cleaned up on state changes/unmount and stop on hidden pages. Five atlases are cached in memory and preloaded after the first loads when animation is enabled. Previous drawing/static fallback stays visible while loading. Greeting/drop completion comes from actual playback, not a parent timeout that can expire before the image arrives. Failed action loads release the one-shot reaction; failed cache entries can retry. Reduced-motion and the persisted 动作 switch are preserved. Resizing the chat window does not trigger carried poses.

The five 960-pixel-wide lossless WebP files total about 2.8 MB on disk, down from roughly 6.7 MB for the original PNG exports. At the launcher's 80 CSS-pixel display size this still provides 3× high-DPI source detail. No LLM/API call is used to play animations.

## Asset provenance

Generated with built-in imagegen using the existing cat character as reference. Common generation prompt:

> Create production animation sprite atlas of SAME white angular chibi cat in reference, thick slate-blue outlines, big triangular ears, tiny body. TRUE transparent PNG alpha0 background, NO black/white/checkerboard background pixels, no gridlines,text,props,shadows. Equal square cells, exactly4columns. Each frame same character proportions and face center with8%inset, stable feet baseline. Sequential frames read left-to-right top-to-bottom ONE continuous articulated action. Redraw actual intermediate eye/paw/tail/leg poses, not repeated or whole-image shifted/scaled copies.

Action-specific additions:

- Idle: 12 frames, 3 rows, 4:3 landscape. Tail slowly sweeps left/right/back; eyelids gradually close and reopen through frames 4–8; slight chest breathing; first/last neutral seated.
- Thinking: 16 frames, 4 rows, square. Same right paw lifts from lap through intermediates to chin at frame 6, holds/taps chin with upward gaze in frames 7–11, lowers in frames 12–16.
- Hello: 16 frames, 4 rows, square. Same right paw lifts over 6 frames, waves twice with wrist motion in frames 7–12, lowers in frames 13–16; smile/blink; do not swap hands.
- Carried: 12 frames, 3 rows, 4:3 landscape. Cat gently held by scruff, ears drooped, wide eyes, arms hang; feet kick left/right in a repeating cycle; stable head/proportions.
- Landing: 12 frames, 3 rows, 4:3 landscape. From dangling limbs, feet approach ground in frames 1–4, knees bend in 5–7, settles seated in 8–12; joints move without squashing the whole picture.

Thinking/carried initially had baked checkerboards. Background-removal edits used imagegen again: remove all gray checkerboard pixels to true alpha 0, retain opaque white bodies and the exact poses/layout, no new background. No manual bitmap editing was used. Alpha presence was verified for all final files.

Original generation outputs are retained privately by the maintainer. Redistribution rights for the reference character and derived assets must be reviewed before public release.

## Checks

- `node --import tsx --test tests/pet-animation.test.ts`: 4 tests passed (frame addresses, timing/loop endings, non-overlapping source rectangles, shipped WebP files and aspect-preserving viewport bounds).
- TypeScript and targeted ESLint passed.
- Production build passed.
- Atlas inspected for pose differences and transparency. Browser interaction QA is not implied by these checks.

This is hand-drawn-style 2D sprite animation, not skeletal/3D animation. More in-between cells do not guarantee rig-like interpolation. Browser interaction QA has not been performed for v4.

## Delivery status (2026-09-11)

The v4 assets were published to the existing v2 site and bundled into the macOS Electron app. The desktop edition runs its bundled local copy; subsequent source changes require rebuilding it. Public hosting is optional and separate from local deployment.
