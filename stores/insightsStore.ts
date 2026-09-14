'use client';

import { create } from 'zustand';

type InsightsStatus = 'idle' | 'queued' | 'loading' | 'ready' | 'error';

interface InsightsState {
  selectionId: string | null;
  output: string;
  status: InsightsStatus;
  error: string | null;
  fromCache: boolean;
  queue: (selectionId: string) => void;
  startRequest: (selectionId: string) => void;
  appendOutput: (selectionId: string, chunk: string) => void;
  completeRequest: (selectionId: string, fromCache?: boolean) => void;
  failRequest: (selectionId: string, message: string) => void;
}

export const useInsightsStore = create<InsightsState>((set) => ({
  selectionId: null,
  output: '',
  status: 'idle',
  error: null,
  fromCache: false,
  queue: (selectionId) => set({ selectionId, output: '', status: 'queued', error: null, fromCache: false }),
  startRequest: (selectionId) => set({ selectionId, output: '', status: 'loading', error: null, fromCache: false }),
  appendOutput: (selectionId, chunk) => set((state) => state.selectionId === selectionId
    ? { output: state.output + chunk }
    : state),
  completeRequest: (selectionId, fromCache = false) => set((state) => state.selectionId === selectionId
    ? { status: 'ready', fromCache }
    : state),
  failRequest: (selectionId, error) => set((state) => state.selectionId === selectionId
    ? { status: 'error', error }
    : state),
}));
