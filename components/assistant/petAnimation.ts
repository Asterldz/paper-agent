export type PetAction = 'idle' | 'thinking' | 'hello' | 'carried' | 'landing';
type Frame = { index: number; duration: number };
export const PET_ATLASES: Record<PetAction, { src: string; columns: number; rows: number; count: number; rowEdges?: readonly number[] }> = {
  idle: { src: '/cat-v4-idle.webp', columns: 4, rows: 3, count: 12, rowEdges: [0, 390 / 1087, 738 / 1087, 1] },
  thinking: { src: '/cat-v4-thinking.webp', columns: 4, rows: 4, count: 16 },
  hello: { src: '/cat-v4-hello.webp', columns: 4, rows: 4, count: 16 },
  carried: { src: '/cat-v4-carried.webp', columns: 4, rows: 3, count: 12, rowEdges: [0, 374 / 1086, 710 / 1086, 1] },
  landing: { src: '/cat-v4-landing.webp', columns: 4, rows: 3, count: 12, rowEdges: [0, 456 / 1086, 784 / 1086, 1] },
};
const frames = (durations: number[]): Frame[] => durations.map((duration, index) => ({ index, duration }));
// Each action has its own atlas of genuine intermediate drawings.
export const PET_SEQUENCES: Record<PetAction, readonly Frame[]> = {
  idle: frames([450, 140, 140, 120, 90, 90, 90, 90, 120, 140, 140, 450]),
  thinking: frames([100, 90, 90, 90, 90, 110, 150, 180, 180, 150, 110, 90, 90, 90, 90, 160]),
  hello: frames([90, 80, 80, 80, 80, 80, 100, 100, 100, 100, 100, 100, 80, 80, 80, 100]),
  carried: frames(Array.from({ length: 12 }, () => 85)),
  landing: frames([70, 70, 70, 70, 80, 90, 90, 80, 80, 80, 90, 140]),
};
export const petActionDuration = (action: PetAction) => PET_SEQUENCES[action].reduce((sum, f) => sum + f.duration, 0);
export function petFrameAt(action: PetAction, elapsed: number): Frame {
  const sequence = PET_SEQUENCES[action];
  const duration = petActionDuration(action);
  const loops = action !== 'hello' && action !== 'landing';
  let time = loops ? Math.max(0, elapsed) % duration : Math.min(Math.max(0, elapsed), duration - 1);
  for (const f of sequence) {
    if (time < f.duration) return { index: f.index, duration: f.duration - time };
    time -= f.duration;
  }
  return sequence[sequence.length - 1];
}
// Source rectangles are normalized; generated atlas rows are not always uniform.
export function petFrameRect(action: PetAction, index: number) {
  const { columns, rows, count, rowEdges } = PET_ATLASES[action];
  const frame = Math.max(0, Math.min(count - 1, Math.trunc(index)));
  const row = Math.floor(frame / columns);
  const y = rowEdges?.[row] ?? row / rows;
  return { x: (frame % columns) / columns, y, width: 1 / columns, height: (rowEdges?.[row + 1] ?? (row + 1) / rows) - y };
}

export function petFrameDrawing(action: PetAction, index: number, imageWidth: number, imageHeight: number, size = 80) {
  const rect = petFrameRect(action, index);
  const sw = rect.width * imageWidth;
  const sh = rect.height * imageHeight;
  // One scale per action, not per-pose fitting (which makes the head pulse).
  const maxHeight = Math.max(...Array.from({ length: PET_ATLASES[action].count }, (_, i) => petFrameRect(action, i).height * imageHeight));
  const scale = Math.min(size * 0.75 / sw, (size - 4) / maxHeight);
  return { sx: rect.x * imageWidth, sy: rect.y * imageHeight, sw, sh, dx: (size - sw * scale) / 2, dy: size - 2 - sh * scale, dw: sw * scale, dh: sh * scale };
}
