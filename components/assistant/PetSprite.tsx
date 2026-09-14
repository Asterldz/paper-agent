'use client';

import { useEffect, useRef } from 'react';
import { PET_ATLASES, petActionDuration, petFrameAt, petFrameDrawing, type PetAction } from './petAnimation';

const atlasCache = new Map<PetAction, Promise<HTMLImageElement>>();
function loadAtlas(action: PetAction) {
  const cached = atlasCache.get(action);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load pet atlas: ${action}`));
    image.src = PET_ATLASES[action].src;
  }).catch((error: unknown) => { atlasCache.delete(action); throw error; });
  atlasCache.set(action, pending);
  return pending;
}

export function PetSprite({ action, replay = 0, paused = false, onComplete }: {
  action: PetAction; replay?: number; paused?: boolean; onComplete?: () => void;
}) {
  const sprite = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = sprite.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let completed = false;
    let started = 0;
    let atlas: HTMLImageElement | undefined;
    const oneShot = action === 'hello' || action === 'landing';
    const finish = () => { if (!completed && !stopped && oneShot) { completed = true; onComplete?.(); } };
    const paint = () => {
      if (stopped || !atlas) return;
      const elapsed = performance.now() - started;
      const f = petFrameAt(action, paused ? 0 : elapsed);
      const d = petFrameDrawing(action, f.index, atlas.naturalWidth, atlas.naturalHeight);
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      if (element.width !== Math.round(80 * ratio)) {
        element.width = Math.round(80 * ratio); element.height = element.width;
      }
      context.setTransform(element.width / 80, 0, 0, element.height / 80, 0, 0);
      context.clearRect(0, 0, 80, 80);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(atlas, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
      element.style.backgroundImage = 'none';
      delete element.dataset.loadError;
      element.dataset.frame = String(f.index);
      if (paused) { finish(); return; }
      if (document.hidden) return;
      if (oneShot && elapsed >= petActionDuration(action)) { finish(); return; }
      timer = setTimeout(paint, Math.max(16, f.duration));
    };
    const restart = () => { clearTimeout(timer); if (document.hidden) return; started = performance.now(); paint(); };
    // Preserve the previous drawing while loading; complete only after playback.
    void loadAtlas(action).then((image) => {
      if (stopped) return;
      atlas = image; restart();
      // Bounded five-atlas cache; preload for the first click/drag.
      if (!paused) for (const next of Object.keys(PET_ATLASES) as PetAction[]) void loadAtlas(next).catch(() => {});
    }).catch(() => { if (!stopped) { element.dataset.loadError = 'true'; finish(); } });
    document.addEventListener('visibilitychange', restart);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', restart); };
  }, [action, replay, paused, onComplete]);
  return <canvas ref={sprite} width={160} height={160} aria-hidden="true" className="pet-sprite" data-action={action} />;
}
