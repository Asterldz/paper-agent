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

## Assets

The project-owned character uses transparent sprite atlases. Assets are covered by the non-commercial license in `LICENSE`.

## Checks

- `node --import tsx --test tests/pet-animation.test.ts`: 4 tests passed (frame addresses, timing/loop endings, non-overlapping source rectangles, shipped WebP files and aspect-preserving viewport bounds).
- TypeScript and targeted ESLint passed.
- Production build passed.
- Atlas inspected for pose differences and transparency. Browser interaction QA is not implied by these checks.

This is hand-drawn-style 2D sprite animation, not skeletal/3D animation. More in-between cells do not guarantee rig-like interpolation. Browser interaction QA has not been performed for v4.

## Delivery status (2026-09-11)

The v4 assets were published to the existing v2 site and bundled into the macOS Electron app. The desktop edition runs its bundled local copy; subsequent source changes require rebuilding it. Public hosting is optional and separate from local deployment.
