import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentPageText } from '@/types/pdf';

export type PdfExportFormat = 'txt' | 'markdown';

export function textFromPdfItems(items: unknown[]): string {
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue;
    const textItem = item as { str: string; hasEOL?: boolean };
    line += textItem.str;
    if (textItem.hasEOL) {
      if (line.trim()) lines.push(line.trim());
      line = '';
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

export async function extractPdfPages(document: PDFDocumentProxy): Promise<DocumentPageText[]> {
  const pages: DocumentPageText[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pages.push({ pageNumber, text: textFromPdfItems(textContent.items) });
  }
  return pages;
}

export async function convertPdfToText(options: {
  document: PDFDocumentProxy;
  fileName: string;
  format: PdfExportFormat;
  onProgress?: (completed: number, total: number) => void;
}) {
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= options.document.numPages; pageNumber += 1) {
    const page = await options.document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textFromPdfItems(textContent.items);
    pages.push(options.format === 'markdown'
      ? `## 第 ${pageNumber} 页\n\n${pageText}`
      : `===== 第 ${pageNumber} 页 =====\n${pageText}`);
    options.onProgress?.(pageNumber, options.document.numPages);
  }

  const extension = options.format === 'markdown' ? 'md' : 'txt';
  const mimeType = options.format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  const content = pages.join(options.format === 'markdown' ? '\n\n---\n\n' : '\n\n');
  const baseName = options.fileName.replace(/\.pdf$/i, '') || 'paper';
  const blobUrl = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = window.document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `${baseName}.${extension}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
