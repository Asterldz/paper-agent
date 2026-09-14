import type { ExternalPaper, ExternalPaperPort, ExternalPaperRead } from '@/types/externalPaper';

const cache = new Map<string, { expires: number; result: ExternalPaperRead }>();
async function request(params: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(`/api/papers?${new URLSearchParams(params)}`, { signal });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `外部文献服务请求失败（HTTP ${response.status}）。`);
  }
  return response;
}

export const externalPapers: ExternalPaperPort = {
  search: async (query, signal) => (await request({ action: 'search', query }, signal)).json(),
  read: async (id, signal) => {
    signal.throwIfAborted();
    const hit = cache.get(id);
    if (hit && hit.expires > Date.now()) return hit.result;
    const response = await request({ action: 'read', id }, signal);
    let result: ExternalPaperRead;
    if (response.headers.get('content-type')?.includes('application/pdf')) {
      const paper = JSON.parse(decodeURIComponent(response.headers.get('x-paper-metadata') ?? '')) as ExternalPaper;
      const { loadPdfFile } = await import('@/services/pdf/pdfLoader');
      const { document, loadingTask } = await loadPdfFile(new File([await response.blob()], 'external.pdf', { type: 'application/pdf' }), signal);
      const abort = () => { void loadingTask.destroy(); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const pages = [];
        const count = Math.min(document.numPages, 150);
        for (let n = 1; n <= count; n++) {
          signal.throwIfAborted();
          const page = await document.getPage(n);
          const content = await page.getTextContent();
          pages.push({ pageNumber: n, text: content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') });
          page.cleanup();
        }
        result = { paper, kind: 'full-text', pages, pageKind: 'pdf', note: `已提取 PDF 前 ${count}/${document.numPages} 页；仅实际检索到的片段用于回答。` };
      } finally { signal.removeEventListener('abort', abort); await loadingTask.destroy(); }
    } else result = await response.json();
    signal.throwIfAborted();
    // A bounded, short-lived local cache; failed and metadata-only reads are not retained.
    if (result.pages.some((page) => page.text.trim()) && result.kind === 'full-text') {
      cache.delete(id);
      cache.set(id, { result, expires: Date.now() + 30 * 60_000 });
      while (cache.size > 8) cache.delete(cache.keys().next().value!);
    }
    return result;
  },
};
