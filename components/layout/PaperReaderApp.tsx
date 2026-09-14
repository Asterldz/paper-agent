'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { ConversionDialog } from '@/components/conversion/ConversionDialog';
import { PaperAssistant } from '@/components/assistant/PaperAssistant';
import { HistoryDialog } from '@/components/library/HistoryDialog';
import { ReferenceDialog } from '@/components/library/ReferenceDialog';
import { PDFViewer } from '@/components/pdf/PDFViewer';
import { TranslationPanel } from '@/components/translation/TranslationPanel';
import { useReaderStore } from '@/stores/readerStore';
import type { PDFViewerHandle } from '@/types/pdf';
import type { TextSelection } from '@/types/pdf';
import { usePaperAgent } from '@/hooks/usePaperAgent';
import { useSelectionInsights } from '@/hooks/useSelectionInsights';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AgentAction } from '@/types/agent';
import type { LibraryDocument } from '@/types/library';
import type { PaperCategory } from '@/types/library';
import {
  documentIdForFile,
  listLibraryDocuments,
  loadLibraryFile,
  removeLibraryDocument,
  saveLibraryDocument,
  saveLibraryDocumentIndex,
  updateLibraryDocument,
  updateLibraryProgress,
} from '@/services/storage/documentLibrary';
import { TopToolbar } from './TopToolbar';
import { warmModelConnection } from '@/services/llm/networkWarmup';
import { loadPdfFile } from '@/services/pdf/pdfLoader';
import { extractPdfPages } from '@/services/pdf/pdfConverter';
import { parseReferenceEntries, resolveReferences } from '@/services/agent/referencePapers';

export function PaperReaderApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<PDFViewerHandle>(null);
  const pendingPageRef = useRef<number | null>(null);
  const openSequenceRef = useRef(0);
  const readerGridRef = useRef<HTMLElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversionOpen, setConversionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [historyDocuments, setHistoryDocuments] = useState<LibraryDocument[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [libraryImporting, setLibraryImporting] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [splitPercent, setSplitPercent] = useState(() => storedNumber('paper-agent:pane-split', 60, 32, 74));
  const [rightScale, setRightScale] = useState(() => storedNumber('paper-agent:right-scale', 1, 0.8, 1.4));
  const { currentPage, documentPages, fileName, totalPages, zoom, setZoom, resetDocument } = useReaderStore();
  const setSelection = useReaderStore((state) => state.setSelection);
  const { activeModelId, autoTranslate, models, hydrate, setActiveModel, setAutoTranslate, translationModelId } = useSettingsStore();
  const { run } = usePaperAgent();
  const { queue: queueInsights, run: runInsights } = useSelectionInsights();
  const openFileDialog = useCallback(() => fileInputRef.current?.click(), []);
  const currentReferences = useMemo(() => parseReferenceEntries(documentPages), [documentPages]);

  useEffect(() => {
    window.localStorage.setItem('paper-agent:pane-split', String(splitPercent));
    window.localStorage.setItem('paper-agent:right-scale', String(rightScale));
  }, [rightScale, splitPercent]);

  const beginPaneResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const grid = readerGridRef.current;
    if (!grid) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('pane-resizing');
    const update = (clientX: number) => {
      const bounds = grid.getBoundingClientRect();
      const next = ((clientX - bounds.left) / bounds.width) * 100;
      setSplitPercent(Math.min(74, Math.max(32, next)));
    };
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const stop = () => {
      document.body.classList.remove('pane-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    update(event.clientX);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const documents = await listLibraryDocuments();
      setHistoryDocuments(documents);
      setHistoryError(null);
    } catch {
      setHistoryError('无法读取当前设备上的文献历史。');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openStoredDocument = useCallback(async (document: LibraryDocument, page = document.currentPage) => {
    const sequence = ++openSequenceRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const storedFile = await loadLibraryFile(document.id);
      if (sequence !== openSequenceRef.current) return;
      setActiveDocumentId(document.id);
      pendingPageRef.current = Math.max(1, page);
      resetDocument();
      setFile(storedFile);
      setHistoryOpen(false);
      setReferencesOpen(false);
    } catch {
      setHistoryError('该文献的本地文件已不可用，可删除记录后重新打开 PDF。');
    } finally {
      if (sequence === openSequenceRef.current) setHistoryLoading(false);
    }
  }, [resetDocument]);

  const indexImportedDocument = useCallback(async (id: string, importedFile: File) => {
    const { document, loadingTask } = await loadPdfFile(importedFile);
    try {
      const pages = await extractPdfPages(document);
      await saveLibraryDocumentIndex(id, pages);
    } finally {
      await loadingTask.destroy();
    }
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []).filter((item) => item.type === 'application/pdf' || /\.pdf$/i.test(item.name));
    event.target.value = '';
    if (!selectedFiles.length) return;
    setReferencesOpen(false);
    setHistoryOpen(false);
    ++openSequenceRef.current;
    const nextFile = selectedFiles[0];
    const documentId = documentIdForFile(nextFile);
    setActiveDocumentId(documentId);
    pendingPageRef.current = 1;
    resetDocument();
    setFile(nextFile);
    setLibraryImporting(true);
    void (async () => {
      try {
        for (const importedFile of selectedFiles) await saveLibraryDocument(importedFile);
        await refreshHistory();
        for (const importedFile of selectedFiles.slice(1)) {
          await indexImportedDocument(documentIdForFile(importedFile), importedFile);
          await refreshHistory();
        }
      } catch (reason: unknown) {
        setHistoryError(reason instanceof DOMException && reason.name === 'QuotaExceededError' ? '设备存储空间不足，无法保存这些文献。' : '部分文献无法解析或保存，请检查 PDF 文件。');
      } finally {
        setLibraryImporting(false);
      }
    })();
  }, [indexImportedDocument, refreshHistory, resetDocument]);

  const handleDocumentIndexed = useCallback((pages: import('@/types/pdf').DocumentPageText[]) => {
    if (!activeDocumentId) return;
    void saveLibraryDocumentIndex(activeDocumentId, pages).then(() => refreshHistory()).catch(() => setHistoryError('全文索引已建立，但文献分类信息保存失败。'));
  }, [activeDocumentId, refreshHistory]);

  const deleteStoredDocument = useCallback(async (id: string) => {
    try {
      await removeLibraryDocument(id);
      if (id === activeDocumentId) setActiveDocumentId(null);
      await refreshHistory();
    } catch {
      setHistoryError('删除本地阅读记录失败。');
    }
  }, [activeDocumentId, refreshHistory]);

  const toggleFavoriteDocument = useCallback(async (document: LibraryDocument) => {
    const favorite = !document.favorite;
    setHistoryDocuments((documents) => documents.map((item) => item.id === document.id ? { ...item, favorite } : item));
    try { await updateLibraryDocument(document.id, { favorite }); await refreshHistory(); }
    catch { setHistoryError('无法更新收藏状态。'); }
  }, [refreshHistory]);

  const changeDocumentCategory = useCallback(async (id: string, category: PaperCategory) => {
    setHistoryDocuments((documents) => documents.map((item) => item.id === id ? { ...item, category } : item));
    try { await updateLibraryDocument(id, { category }); }
    catch { setHistoryError('无法更新文献分类。'); await refreshHistory(); }
  }, [refreshHistory]);

  useEffect(() => {
    hydrate();
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openFileDialog();
      }
      if (event.key === 'Escape') { setSettingsOpen(false); setConversionOpen(false); setHistoryOpen(false); setReferencesOpen(false); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hydrate, openFileDialog]);

  useEffect(() => {
    const preferredId = translationModelId ?? activeModelId;
    const model = models.find((item) => item.id === preferredId);
    if (model) warmModelConnection(model.baseUrl);
  }, [activeModelId, models, translationModelId]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++openSequenceRef.current;
    void (async () => {
      try {
        const documents = await listLibraryDocuments();
        if (cancelled || sequence !== openSequenceRef.current) return;
        setHistoryDocuments(documents);
        setHistoryError(null);
        const recent = documents[0];
        if (!recent) return;
        const storedFile = await loadLibraryFile(recent.id);
        if (cancelled || sequence !== openSequenceRef.current) return;
        setActiveDocumentId(recent.id);
        pendingPageRef.current = Math.max(1, recent.currentPage);
        resetDocument();
        setFile(storedFile);
      } catch {
        if (!cancelled) setHistoryError('无法恢复上次打开的文献，你仍可重新选择 PDF。');
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [resetDocument]);

  useEffect(() => {
    const targetPage = pendingPageRef.current;
    if (!targetPage || !totalPages) return;
    const timer = window.setTimeout(() => {
      viewerRef.current?.goToPage(Math.min(targetPage, totalPages));
      pendingPageRef.current = null;
    }, 120);
    return () => window.clearTimeout(timer);
  }, [file, totalPages]);

  useEffect(() => {
    if (!activeDocumentId || !totalPages) return;
    const id = activeDocumentId;
    const page = Math.min(Math.max(currentPage, 1), totalPages);
    const timer = window.setTimeout(() => {
      const lastReadAt = Date.now();
      void updateLibraryProgress(id, page, totalPages)
        .then(() => setHistoryDocuments((documents) => documents
          .map((document) => document.id === id ? { ...document, currentPage: page, totalPages, lastReadAt } : document)
          .sort((a, b) => b.lastReadAt - a.lastReadAt)))
        .catch(() => setHistoryError('无法保存当前阅读位置。'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeDocumentId, currentPage, totalPages]);

  const handleSelection = useCallback((selection: TextSelection) => {
    setSelection(selection);
    queueInsights(selection.id);
    if (autoTranslate) {
      if (!activeModelId || !models.some((model) => model.id === activeModelId)) setSettingsOpen(true);
      void run(selection, 'translate').then((completed) => {
        if (completed && useReaderStore.getState().activeSelection?.id === selection.id) void runInsights(selection);
      });
    }
  }, [activeModelId, autoTranslate, models, queueInsights, run, runInsights, setSelection]);

  const runSelectionAction = useCallback((action: AgentAction) => {
    const selection = useReaderStore.getState().activeSelection;
    if (!selection) return;
    if (!useSettingsStore.getState().activeModelId) setSettingsOpen(true);
    void run(selection, action).then((completed) => {
      if (completed && useReaderStore.getState().activeSelection?.id === selection.id) void runInsights(selection);
    });
  }, [run, runInsights]);

  const openReferencePaper = useCallback((referenceNumber: number, page?: number) => {
    if (!activeDocumentId) return;
    const reference = resolveReferences(currentReferences, historyDocuments, activeDocumentId)
      .find((item) => item.number === referenceNumber);
    const document = historyDocuments.find((item) => item.id === reference?.matchedDocumentId);
    if (document) void openStoredDocument(document, page ?? document.currentPage);
    else setReferencesOpen(true);
  }, [activeDocumentId, currentReferences, historyDocuments, openStoredDocument]);

  return (
    <main className="flex h-dvh min-h-[620px] flex-col overflow-hidden bg-[#f1f2f4] text-[#27292e]">
      <TopToolbar activeModelId={activeModelId} autoTranslate={autoTranslate} currentPage={currentPage} fileName={fileName} historyCount={historyDocuments.length} models={models} referenceCount={currentReferences.length} totalPages={totalPages} zoom={zoom} onAutoTranslateChange={() => setAutoTranslate(!autoTranslate)} onNavigate={(page) => viewerRef.current?.goToPage(page)} onOpen={openFileDialog} onOpenConverter={() => setConversionOpen(true)} onOpenHistory={() => { setHistoryOpen(true); void refreshHistory(); }} onOpenReferences={() => { setReferencesOpen(true); void refreshHistory(); }} onOpenSettings={() => setSettingsOpen(true)} onSelectModel={setActiveModel} onZoomChange={setZoom} />
      <input ref={fileInputRef} accept="application/pdf,.pdf" className="hidden" multiple onChange={handleFileChange} type="file" />
      <section ref={readerGridRef} className="reader-grid min-h-0 flex-1" style={{ '--left-pane': `${splitPercent}%` } as React.CSSProperties}>
        <PDFViewer key={file ? `${file.name}-${file.lastModified}-${file.size}` : 'empty'} ref={viewerRef} file={file} onDocumentIndexed={handleDocumentIndexed} onOpen={openFileDialog} onSelection={handleSelection} />
        <button
          aria-label="调整左右版面宽度"
          aria-orientation="vertical"
          className="pane-divider"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') { event.preventDefault(); setSplitPercent((value) => Math.max(32, value - 2)); }
            if (event.key === 'ArrowRight') { event.preventDefault(); setSplitPercent((value) => Math.min(74, value + 2)); }
          }}
          onPointerDown={beginPaneResize}
          role="separator"
          type="button"
        ><span /></button>
        <TranslationPanel onAction={runSelectionAction} onScaleChange={(value) => setRightScale(Math.min(1.4, Math.max(0.8, Number(value.toFixed(1)))))} scale={rightScale} />
      </section>
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {conversionOpen && file ? <ConversionDialog fileName={file.name} onClose={() => setConversionOpen(false)} onConvert={async (format, onProgress) => { await viewerRef.current?.exportText(format, onProgress); }} /> : null}
      {historyOpen ? <HistoryDialog activeDocumentId={activeDocumentId} documents={historyDocuments} error={historyError} isImporting={libraryImporting} isLoading={historyLoading} onCategoryChange={(id, category) => void changeDocumentCategory(id, category)} onClose={() => setHistoryOpen(false)} onDelete={(id) => void deleteStoredDocument(id)} onImport={openFileDialog} onOpen={(document) => void openStoredDocument(document)} onToggleFavorite={(document) => void toggleFavoriteDocument(document)} /> : null}
      {referencesOpen && activeDocumentId ? <ReferenceDialog activeDocumentId={activeDocumentId} currentPages={documentPages} documents={historyDocuments} onClose={() => setReferencesOpen(false)} onImport={openFileDialog} onNavigate={(page) => viewerRef.current?.goToPage(page)} onOpenDocument={(document, page) => void openStoredDocument(document, page)} /> : null}
      <PaperAssistant activeDocumentId={activeDocumentId} onNavigate={(page) => viewerRef.current?.goToPage(page)} onOpenReference={openReferencePaper} onOpenReferences={() => setReferencesOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onOpenDocument={(id, page) => { void listLibraryDocuments().then((documents) => { const document = documents.find((item) => item.id === id); if (document) return openStoredDocument(document, page); setHistoryError('来源文件已不在本地文献库。'); setHistoryOpen(true); }).catch(() => { setHistoryError('无法打开来源文件。'); setHistoryOpen(true); }); }} referenceCount={currentReferences.length} />
    </main>
  );
}

function storedNumber(key: string, fallback: number, minimum: number, maximum: number) {
  if (typeof window === 'undefined') return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}
