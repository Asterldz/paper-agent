'use client';

import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import { memo, useEffect, useRef, useState } from 'react';
import { createTextLayer } from '@/services/pdf/pdfLoader';
import { primePdfSelectionLayer } from '@/services/pdf/selectionManager';

interface PDFPageProps {
  document: PDFDocumentProxy;
  estimatedHeight: number;
  estimatedWidth: number;
  highlightRects: Array<{ height: number; left: number; top: number; width: number }>;
  onVisible: (pageNumber: number) => void;
  pageNumber: number;
  zoom: number;
}

function PDFPageComponent({ document, estimatedHeight, estimatedWidth, highlightRects, onVisible, pageNumber, zoom }: PDFPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2);
  const [dimensions, setDimensions] = useState({ width: estimatedWidth, height: estimatedHeight });
  const [error, setError] = useState('');

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const scrollRoot = wrapper.closest<HTMLElement>('.pdf-scroll');
    const renderObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShouldRender(true);
        else if (!wrapper.closest('.pdf-selection-active')) setShouldRender(false);
      },
      { root: scrollRoot, rootMargin: '1000px 0px', threshold: 0 },
    );
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.45) onVisible(pageNumber);
      },
      { root: scrollRoot, threshold: [0.45] },
    );
    renderObserver.observe(wrapper);
    visibilityObserver.observe(wrapper);
    return () => {
      renderObserver.disconnect();
      visibilityObserver.disconnect();
    };
  }, [onVisible, pageNumber]);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;

    async function renderPage() {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: zoom });
      setDimensions({ width: viewport.width, height: viewport.height });

      const canvas = canvasRef.current;
      const textContainer = textLayerRef.current;
      if (!canvas || !textContainer) return;

      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      textContainer.replaceChildren();
      textContainer.style.setProperty('--scale-factor', String(zoom));
      textContainer.style.setProperty('--user-unit', '1');
      textContainer.style.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit))');
      textContainer.style.setProperty('--scale-round-x', '1px');
      textContainer.style.setProperty('--scale-round-y', '1px');

      renderTask = page.render({
        canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      const textLayerPromise = createTextLayer({ container: textContainer, page, viewport });
      const [, renderedTextLayer] = await Promise.all([renderTask.promise, textLayerPromise]);
      textLayer = renderedTextLayer;
      if (!cancelled) {
        primePdfSelectionLayer(textContainer);
        setError('');
      }
    }

    renderPage().catch((reason: unknown) => {
      if (cancelled || (reason instanceof Error && reason.name === 'RenderingCancelledException')) return;
      setError('此页暂时无法渲染');
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, pageNumber, shouldRender, zoom]);

  return (
    <div
      ref={wrapperRef}
      className="pdf-page-shell"
      data-page-number={pageNumber}
      style={{ height: dimensions.height, width: dimensions.width }}
    >
      {shouldRender ? (
        <>
          <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} className="pointer-events-none block select-none" />
          <div ref={textLayerRef} className="textLayer" data-page-number={pageNumber} />
          {error ? <div className="absolute inset-0 grid place-items-center bg-white text-sm text-red-600">{error}</div> : null}
        </>
      ) : (
        <div className="grid h-full place-items-center bg-white text-xs text-[#a0a5ae]">第 {pageNumber} 页</div>
      )}
      {highlightRects.length ? <div aria-hidden="true" className="selection-overlay">{highlightRects.map((rect, index) => <span key={`${index}-${rect.left}-${rect.top}`} style={rect} />)}</div> : null}
    </div>
  );
}

export const PDFPage = memo(PDFPageComponent);
