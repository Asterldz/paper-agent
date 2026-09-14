'use client';

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { loadPdfFile } from '@/services/pdf/pdfLoader';
import { useTextSelection } from '@/hooks/useTextSelection';
import { useReaderStore } from '@/stores/readerStore';
import type { PdfColumnMode, PDFViewerHandle, SelectionHighlight, TextSelection } from '@/types/pdf';
import { PDFPage } from './PDFPage';
import { convertPdfToText, extractPdfPages } from '@/services/pdf/pdfConverter';

interface PDFViewerProps {
  file: File | null;
  onDocumentIndexed?: (pages: import('@/types/pdf').DocumentPageText[]) => void;
  onOpen: () => void;
  onSelection: (selection: TextSelection) => void;
}

const EMPTY_HIGHLIGHT_RECTS: SelectionHighlight['rects'] = [];
const EMPTY_COLUMN_MODES: Record<number, PdfColumnMode> = {};

export const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(function PDFViewer({ file, onDocumentIndexed, onOpen, onSelection }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRootRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const zoom = useReaderStore((state) => state.zoom);
  const currentPage = useReaderStore((state) => state.currentPage);
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : '';
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageSize, setPageSize] = useState({ height: 792, width: 612 });
  const [selectionHighlightState, setSelectionHighlightState] = useState<{ highlights: SelectionHighlight[]; zoom: number }>({ highlights: [], zoom });
  const [selectionMode, setSelectionMode] = useState<'precise' | 'paragraph'>('precise');
  const [columnModeState, setColumnModeState] = useState<{ fileKey: string; modes: Record<number, PdfColumnMode> }>({ fileKey: '', modes: {} });
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => file ? 'loading' : 'idle');
  const [error, setError] = useState('');
  const setDocumentMetadata = useReaderStore((state) => state.setDocument);
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const setDocumentIndex = useReaderStore((state) => state.setDocumentIndex);
  const handleHighlight = useCallback((highlights: SelectionHighlight[]) => setSelectionHighlightState({ highlights, zoom }), [zoom]);
  const columnModes = columnModeState.fileKey === fileKey ? columnModeState.modes : EMPTY_COLUMN_MODES;
  const columnModeForPage = useCallback((pageNumber: number) => columnModes[pageNumber] ?? 'auto', [columnModes]);
  useTextSelection(viewerRootRef, onSelection, handleHighlight, selectionMode, columnModeForPage);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    loadPdfFile(file)
      .then(async ({ document: loadedDocument, loadingTask }) => {
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }
        loadingTaskRef.current = loadingTask;
        const firstPage = await loadedDocument.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        setPageSize({ height: viewport.height, width: viewport.width });
        setSelectionHighlightState({ highlights: [], zoom: 0 });
        setDocument(loadedDocument);
        setDocumentMetadata(file.name, loadedDocument.numPages);
        setStatus('ready');
        void extractPdfPages(loadedDocument)
          .then((pages) => { if (!cancelled) { setDocumentIndex(pages); onDocumentIndexed?.(pages); } })
          .catch(() => { if (!cancelled) setDocumentIndex([]); });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(reason instanceof Error && reason.name === 'PasswordException' ? '该 PDF 受密码保护，当前版本暂不支持。' : '无法打开该 PDF，请确认文件未损坏。');
      });

    return () => {
      cancelled = true;
      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
  }, [file, onDocumentIndexed, setDocumentIndex, setDocumentMetadata]);

  const goToPage = useCallback((pageNumber: number) => {
    const container = scrollRef.current;
    const page = container?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
    page?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const exportText = useCallback(async (format: import('@/services/pdf/pdfConverter').PdfExportFormat, onProgress: (completed: number, total: number) => void) => {
    if (!document || !file) throw new Error('No PDF is open.');
    await convertPdfToText({ document, fileName: file.name, format, onProgress });
  }, [document, file]);

  useImperativeHandle(ref, () => ({ goToPage, exportText }), [exportText, goToPage]);
  const handleVisible = useCallback((pageNumber: number) => setCurrentPage(pageNumber), [setCurrentPage]);

  return (
    <div ref={viewerRootRef} className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-[#dfe1e5] bg-[#e7e9ec]">
      <div className="document-bar flex h-12 shrink-0 items-center justify-between gap-3 px-5 text-[10px]">
        <span className="font-semibold tracking-[0.16em] text-[#56544f]">原文</span>
        {status === 'ready' ? (
          <div className="flex min-w-0 items-center gap-2">
            <div className="selection-mode-control" aria-label="文字选择模式">
              <button aria-pressed={selectionMode === 'precise'} className={selectionMode === 'precise' ? 'active' : ''} onClick={() => setSelectionMode('precise')} type="button">精准划选</button>
              <button aria-pressed={selectionMode === 'paragraph'} className={selectionMode === 'paragraph' ? 'active' : ''} onClick={() => setSelectionMode('paragraph')} type="button">点击段落</button>
            </div>
            <label className="page-layout-control" title="自动识别不准确时，可指定当前页为单栏或双栏">
              <span>本页版式</span>
              <select
                aria-label={`第 ${currentPage} 页版式`}
                onChange={(event) => {
                  const value = event.target.value as PdfColumnMode;
                  setColumnModeState((current) => ({
                    fileKey,
                    modes: { ...(current.fileKey === fileKey ? current.modes : EMPTY_COLUMN_MODES), [currentPage]: value },
                  }));
                  setSelectionHighlightState({ highlights: [], zoom });
                }}
                value={columnModes[currentPage] ?? 'auto'}
              >
                <option value="auto">自动</option>
                <option value="single">单栏</option>
                <option value="double">双栏</option>
              </select>
            </label>
          </div>
        ) : null}
        <span className="document-mode-status">{status === 'loading' ? '正在解析文献…' : status === 'ready' ? (selectionMode === 'precise' ? '同栏精准 · 左栏到底再跨栏' : '单击选择整段') : '文件仅保存在本地'}</span>
      </div>
      {!file ? <PDFEmptyState onOpen={onOpen} /> : null}
      {status === 'loading' ? <div className="grid min-h-0 flex-1 place-items-center"><div className="text-center"><span className="loading-spinner mx-auto mb-3 block" /><p className="text-xs text-[#7e8490]">正在载入论文…</p></div></div> : null}
      {status === 'error' ? <div className="grid min-h-0 flex-1 place-items-center p-8"><div className="max-w-sm rounded-xl border border-red-200 bg-white p-6 text-center"><p className="text-sm font-medium text-red-700">PDF 加载失败</p><p className="mt-2 text-xs leading-5 text-[#777e8a]">{error}</p><button className="toolbar-button mt-4" onClick={onOpen} type="button">选择其他文件</button></div></div> : null}
      {status === 'ready' && document ? (
        <div ref={scrollRef} className="pdf-scroll min-h-0 flex-1 overflow-auto px-8 py-7">
          <div className="mx-auto flex w-max min-w-full flex-col items-center gap-6">
            {Array.from({ length: document.numPages }, (_, index) => (
              <PDFPage
                key={index + 1}
                document={document}
                estimatedHeight={pageSize.height * zoom}
                estimatedWidth={pageSize.width * zoom}
                highlightRects={selectionHighlightState.zoom === zoom ? selectionHighlightState.highlights.find((highlight) => highlight.pageNumber === index + 1)?.rects ?? EMPTY_HIGHLIGHT_RECTS : EMPTY_HIGHLIGHT_RECTS}
                onVisible={handleVisible}
                pageNumber={index + 1}
                zoom={zoom}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

function PDFEmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-8">
      <div className="w-full max-w-md rounded-xl border border-[#d9dce1] bg-white px-8 py-10 text-center shadow-[0_8px_28px_rgba(33,37,45,0.07)]">
        <div className="empty-document-mark mx-auto mb-5"><span>PDF</span></div><h1 className="editorial-heading text-[25px]">打开一篇文献</h1><p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[#77746c]">PDF 仅在当前设备中读取。划选原文后，译文与术语线索会出现在右侧。</p><button className="primary-button mt-6" onClick={onOpen} type="button">选择 PDF</button><p className="mt-4 text-[10px] tracking-[0.08em] text-[#99968e]">快捷键 ⌘ O</p>
      </div>
    </div>
  );
}
