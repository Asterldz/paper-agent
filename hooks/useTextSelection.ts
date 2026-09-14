'use client';

import { useEffect, type RefObject } from 'react';
import {
  anchorsAreInDifferentColumns,
  hasReachedColumnContinuationBoundary,
  paragraphAnchorsAtPoint,
  readSnappedHighlights,
  readSnappedSelection,
  wordAnchorAtPoint,
  type PdfWordAnchor,
} from '@/services/pdf/selectionManager';
import type { PdfColumnMode, SelectionHighlight, TextSelection } from '@/types/pdf';

const DUPLICATE_WINDOW_MS = 1000;

export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
  onSelection: (selection: TextSelection) => void,
  onHighlight: (highlights: SelectionHighlight[]) => void,
  mode: 'precise' | 'paragraph',
  columnModeForPage: (pageNumber: number) => PdfColumnMode,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let animationFrame: number | undefined;
    let lastSignature = '';
    let lastTimestamp = 0;
    let activePointerId: number | null = null;
    let anchor: PdfWordAnchor | null = null;
    let focus: PdfWordAnchor | null = null;
    let canContinueAcrossColumns = false;
    let pointerStart = { x: 0, y: 0 };

    const finishPointer = () => {
      activePointerId = null;
      anchor = null;
      focus = null;
      canContinueAcrossColumns = false;
      container.classList.remove('pdf-selection-active');
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('.textLayer')) return;
      const hit = wordAnchorAtPoint(container, event.clientX, event.clientY);
      if (!hit) return;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      activePointerId = event.pointerId;
      anchor = hit;
      focus = hit;
      canContinueAcrossColumns = hasReachedColumnContinuationBoundary(
        container,
        hit,
        hit,
        columnModeForPage(hit.pageNumber),
      );
      pointerStart = { x: event.clientX, y: event.clientY };
      container.classList.add('pdf-selection-active');
      onHighlight(readSnappedHighlights(container, hit, hit, columnModeForPage(hit.pageNumber)));
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId || !anchor) return;
      event.preventDefault();
      const hit = wordAnchorAtPoint(container, event.clientX, event.clientY);
      if (!hit || (focus?.pageNumber === hit.pageNumber && focus.index === hit.index)) return;
      const columnMode = columnModeForPage(anchor.pageNumber);
      if (anchorsAreInDifferentColumns(anchor, hit, columnMode) && !canContinueAcrossColumns) return;
      focus = hit;
      if (!canContinueAcrossColumns) {
        canContinueAcrossColumns = hasReachedColumnContinuationBoundary(container, anchor, hit, columnMode);
      }
      onHighlight(readSnappedHighlights(container, anchor, hit, columnMode));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return;
      const currentAnchor = anchor;
      const currentFocus = focus;
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5;
      window.cancelAnimationFrame(animationFrame ?? 0);
      animationFrame = window.requestAnimationFrame(() => {
        const processingStartedAt = performance.now();
        const columnMode = currentAnchor ? columnModeForPage(currentAnchor.pageNumber) : 'auto';
        const paragraphRange = mode === 'paragraph' && !moved
          ? paragraphAnchorsAtPoint(container, event.clientX, event.clientY, columnMode)
          : null;
        const finalAnchor = paragraphRange?.[0] ?? currentAnchor;
        const finalFocus = paragraphRange?.[1] ?? currentFocus;
        const selection = finalAnchor && finalFocus ? readSnappedSelection(container, finalAnchor, finalFocus, columnMode) : null;
        if (!selection || !finalAnchor || !finalFocus) {
          onHighlight([]);
          finishPointer();
          return;
        }
        const highlights = readSnappedHighlights(container, finalAnchor, finalFocus, columnMode);
        selection.selectionProcessingMs = performance.now() - processingStartedAt;
        onHighlight(highlights);
        const signature = `${selection.pageNumber}:${selection.selectedText.toLocaleLowerCase()}`;
        const now = performance.now();
        if (signature === lastSignature && now - lastTimestamp < DUPLICATE_WINDOW_MS) {
          finishPointer();
          return;
        }
        lastSignature = signature;
        lastTimestamp = now;
        onSelection(selection);
        finishPointer();
      });
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (activePointerId === event.pointerId) finishPointer();
    };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.cancelAnimationFrame(animationFrame ?? 0);
      container.classList.remove('pdf-selection-active');
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [columnModeForPage, containerRef, mode, onHighlight, onSelection]);
}
