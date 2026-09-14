import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PET_ATLASES, PET_SEQUENCES, petActionDuration, petFrameAt, petFrameRect, petFrameDrawing, type PetAction } from '../components/assistant/petAnimation';

test('each state plays every frame address inside its action range', () => {
  for (const action of Object.keys(PET_SEQUENCES) as PetAction[]) {
    let elapsed = 0;
    const seen = new Set<number>();
    for (const frame of PET_SEQUENCES[action]) {
      const actual = petFrameAt(action, elapsed);
      assert.equal(actual.index, frame.index);
      assert.equal(actual.duration, frame.duration);
      assert.ok(actual.index >= 0 && actual.index < PET_ATLASES[action].count);
      seen.add(actual.index); elapsed += frame.duration;
    }
    assert.equal(seen.size, PET_ATLASES[action].count, `${action} must use every unique frame`);
  }
});
test('idle/thinking/carried loop; greeting/landing stop on final frame', () => {
  for (const action of ['idle', 'thinking', 'carried'] as const) assert.equal(petFrameAt(action, petActionDuration(action)).index, PET_SEQUENCES[action][0].index);
  for (const action of ['hello', 'landing'] as const) assert.equal(petFrameAt(action, 100000).index, PET_SEQUENCES[action].at(-1)?.index);
});
test('atlases address 68 non-overlapping source rectangles', () => {
  let total = 0;
  for (const action of Object.keys(PET_ATLASES) as PetAction[]) {
    const { count } = PET_ATLASES[action]; total += count;
    const rects = Array.from({ length: count }, (_, i) => petFrameRect(action, i));
    assert.equal(new Set(rects.map((rect) => JSON.stringify(rect))).size, count);
    for (const [i, a] of rects.entries()) {
      assert.ok(a.x >= 0 && a.y >= 0 && a.width > 0 && a.height > 0);
      assert.ok(a.x + a.width <= 1.000001 && a.y + a.height <= 1.000001);
      for (const b of rects.slice(i + 1)) {
        const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        assert.ok(overlapWidth < 0.000001 || overlapHeight < 0.000001);
      }
    }
  }
  assert.equal(total, 68);
});

test('all shipped WebP atlases are valid and fit the viewport at a constant scale', () => {
  for (const action of Object.keys(PET_ATLASES) as PetAction[]) {
    const atlas = PET_ATLASES[action];
    const webp = readFileSync(new URL(`../public${atlas.src}`, import.meta.url));
    assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
    assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
    const sourceSize = action === 'thinking' || action === 'hello' ? [960, 960] : [960, action === 'idle' ? 721 : 720];
    const [width, height] = sourceSize;
    let scale: number | undefined;
    for (let i = 0; i < atlas.count; i++) {
      const d = petFrameDrawing(action, i, width, height);
      assert.ok(d.dx >= 0 && d.dy >= 0);
      assert.ok(d.dx + d.dw <= 80.000001 && d.dy + d.dh <= 80.000001);
      assert.ok(Math.abs(d.dw / d.sw - d.dh / d.sh) < 0.000001);
      if (scale !== undefined) assert.equal(d.dw / d.sw, scale);
      scale = d.dw / d.sw;
    }
  }
});
