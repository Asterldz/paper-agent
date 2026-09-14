import type { DocumentPageText } from './pdf';

export interface ExternalPaper {
  id: string;
  title: string;
  doi?: string;
  year?: number;
  url: string;
  abstract?: string;
  pmcid?: string;
  provider: 'Europe PMC' | 'Crossref' | 'arXiv';
}

export interface ExternalPaperRead {
  paper: ExternalPaper;
  kind: 'full-text' | 'abstract' | 'metadata';
  pages: DocumentPageText[];
  pageKind: 'pdf' | 'section';
  note: string;
}

export interface ExternalPaperPort {
  search: (query: string, signal: AbortSignal) => Promise<{ papers: ExternalPaper[]; warnings: string[] }>;
  read: (id: string, signal: AbortSignal) => Promise<ExternalPaperRead>;
}
