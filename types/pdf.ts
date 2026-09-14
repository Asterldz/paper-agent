export interface TextSelection {
  id: string;
  selectedText: string;
  surroundingText: string;
  pageNumber: number;
  timestamp: number;
  selectionProcessingMs?: number;
}

export interface SelectionHighlight {
  pageNumber: number;
  rects: Array<{ height: number; left: number; top: number; width: number }>;
}

export type PdfColumnMode = 'auto' | 'single' | 'double';

export interface DocumentPageText {
  pageNumber: number;
  text: string;
}

export interface PDFViewerHandle {
  goToPage: (pageNumber: number) => void;
  exportText: (format: import('@/services/pdf/pdfConverter').PdfExportFormat, onProgress: (completed: number, total: number) => void) => Promise<void>;
}
