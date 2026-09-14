'use client';

import { create } from 'zustand';
import type { DocumentPageText, TextSelection } from '@/types/pdf';

interface ReaderState {
  fileName: string;
  currentPage: number;
  totalPages: number;
  zoom: number;
  activeSelection: TextSelection | null;
  documentPages: DocumentPageText[];
  isIndexing: boolean;
  setDocument: (fileName: string, totalPages: number) => void;
  setCurrentPage: (pageNumber: number) => void;
  setZoom: (zoom: number) => void;
  setSelection: (selection: TextSelection) => void;
  setDocumentIndex: (pages: DocumentPageText[]) => void;
  resetDocument: () => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  fileName: '',
  currentPage: 1,
  totalPages: 0,
  zoom: 1,
  activeSelection: null,
  documentPages: [],
  isIndexing: false,
  setDocument: (fileName, totalPages) => set({ fileName, totalPages, currentPage: 1, documentPages: [], isIndexing: true }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  setZoom: (zoom) => set({ zoom: Math.min(2.25, Math.max(0.6, zoom)) }),
  setSelection: (activeSelection) => set({ activeSelection }),
  setDocumentIndex: (documentPages) => set({ documentPages, isIndexing: false }),
  resetDocument: () => set({ fileName: '', totalPages: 0, currentPage: 1, activeSelection: null, documentPages: [], isIndexing: false }),
}));
