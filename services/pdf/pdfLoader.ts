import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerConfigured = false;

async function getPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    workerConfigured = true;
  }
  return pdfjs;
}

export async function loadPdfFile(file: File, signal?: AbortSignal): Promise<{
  document: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
}> {
  const pdfjs = await getPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const abort = () => { void loadingTask.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const document = await loadingTask.promise;
    signal?.throwIfAborted();
    return { document, loadingTask };
  } catch (error) {
    await loadingTask.destroy();
    throw error;
  } finally { signal?.removeEventListener('abort', abort); }
}

export async function createTextLayer(options: {
  container: HTMLElement;
  page: import('pdfjs-dist').PDFPageProxy;
  viewport: import('pdfjs-dist').PageViewport;
}) {
  const pdfjs = await getPdfJs();
  const textContent = await options.page.getTextContent();
  const textLayer = new pdfjs.TextLayer({
    container: options.container,
    textContentSource: textContent,
    viewport: options.viewport,
  });
  await textLayer.render();
  return textLayer;
}
