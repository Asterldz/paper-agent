'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
const KEY = 'paper-assistant-layout-v2';
const PET = 80;
const pad = 8;
const bounds = () => ({ width: window.innerWidth, height: window.innerHeight });
const limit = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));
function petBounds(p: Point): Point {
  const v = bounds();
  return { x: limit(p.x, pad, v.width - PET - pad), y: limit(p.y, pad, v.height - PET - pad) };
}
function boxBounds(b: Box): Box {
  const v = bounds();
  const width = limit(b.width, Math.min(320, v.width - pad * 2), v.width - pad * 2);
  const height = limit(b.height, Math.min(340, v.height - pad * 2), v.height - pad * 2);
  return { width, height, x: limit(b.x, pad, v.width - width - pad), y: limit(b.y, pad, v.height - height - pad) };
}
function beside(p: Point, width = 430, height = 620): Box {
  const v = bounds();
  // Prefer above the pet; near the top, use the side with more room.
  if (p.y >= height + 20) return boxBounds({ width, height, x: p.x + PET - width, y: p.y - height - 12 });
  if (p.y + PET + 12 + height <= v.height) return boxBounds({ width, height, x: p.x + PET - width, y: p.y + PET + 12 });
  return boxBounds({ width, height, x: p.x > v.width / 2 ? p.x - width - 12 : p.x + PET + 12, y: p.y });
}

export function useAssistantFloat() {
  const [layout, setLayout] = useState<{ pet: Point; panel: Box } | null>(null);
  const latest = useRef(layout);
  const gesture = useRef<{ id: number; x: number; y: number; kind: string; initial: NonNullable<typeof layout>; moved: boolean } | null>(null);
  const suppressed = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [petCarried, setPetCarried] = useState(false);
  const update = useCallback((next: NonNullable<typeof layout>) => { latest.current = next; setLayout(next); }, []);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(latest.current)); } catch { /* Storage may be disabled. */ } };
  useEffect(() => {
    let cancelled = false;
    const restore = () => {
      let pet = petBounds({ x: innerWidth - 106, y: innerHeight - 100 });
      let panel = beside(pet);
      try {
        const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (stored && [stored.pet?.x, stored.pet?.y, stored.panel?.x, stored.panel?.y, stored.panel?.width, stored.panel?.height].every(Number.isFinite)) {
          pet = petBounds(stored.pet); panel = boxBounds(stored.panel);
        }
      } catch { /* Use a visible default for invalid preferences. */ }
      if (!cancelled) update({ pet, panel });
    };
    queueMicrotask(restore);
    const resize = () => { const l = latest.current; if (l) update({ pet: petBounds(l.pet), panel: boxBounds(l.panel) }); };
    window.addEventListener('resize', resize);
    return () => { cancelled = true; window.removeEventListener('resize', resize); };
  }, [update]);
  const start = (e: ReactPointerEvent<HTMLElement>, kind: string) => {
    if (!latest.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (kind === 'panel' && (e.target as HTMLElement).closest('button,input,a')) return;
    suppressed.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, kind, initial: latest.current, moved: false };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) > 4) g.moved = true;
    if (!g.moved) return;
    e.preventDefault(); setDragging(true);
    setPetCarried(g.kind === 'pet' || g.kind === 'panel');
    const { pet, panel } = g.initial;
    if (g.kind === 'pet' || g.kind === 'panel') {
      const movedPet = petBounds({ x: pet.x + dx, y: pet.y + dy });
      const delta = g.kind === 'pet' ? { x: movedPet.x - pet.x, y: movedPet.y - pet.y } : { x: dx, y: dy };
      update({ pet: movedPet, panel: boxBounds({ ...panel, x: panel.x + delta.x, y: panel.y + delta.y }) });
    } else {
      const v = bounds();
      const minW = Math.min(320, v.width - 16), minH = Math.min(340, v.height - 16);
      let left = panel.x, top = panel.y, right = left + panel.width, bottom = top + panel.height;
      if (g.kind.includes('w')) left = limit(left + dx, pad, right - minW);
      if (g.kind.includes('e')) right = limit(right + dx, left + minW, v.width - pad);
      if (g.kind.includes('n')) top = limit(top + dy, pad, bottom - minH);
      if (g.kind.includes('s')) bottom = limit(bottom + dy, top + minH, v.height - pad);
      update({ pet, panel: { x: left, y: top, width: right - left, height: bottom - top } });
    }
  };
  const finish = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null; setDragging(false); setPetCarried(false);
    suppressed.current = g.moved && g.kind === 'pet';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    save();
  };
  const events = (kind: string) => ({ onPointerDown: (e: ReactPointerEvent<HTMLElement>) => start(e, kind), onPointerMove: move, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish });
  const toggleAllowed = () => { if (suppressed.current) { suppressed.current = false; return false; } return true; };
  const resetSize = () => { if (latest.current) { update({ ...latest.current, panel: beside(latest.current.pet) }); save(); } };
  const resizeBy = (delta: number) => { if (latest.current) { const l = latest.current; update({ ...l, panel: boxBounds({ ...l.panel, width: l.panel.width + delta, height: l.panel.height + delta }) }); save(); } };
  return { layout, dragging, petCarried, events, toggleAllowed, resetSize, resizeBy };
}
