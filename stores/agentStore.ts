'use client';

import { create } from 'zustand';
import type { AgentAction } from '@/types/agent';

export interface AgentMetrics {
  cacheLookupMs: number;
  cachedSegments: number;
  firstTokenMs: number | null;
  segmentCount: number;
  selectionProcessingMs: number;
  termHits: number;
  totalMs: number | null;
}

interface AgentState {
  currentAction: AgentAction | null;
  output: string;
  isLoading: boolean;
  activeRequestId: string | null;
  error: string | null;
  fromCache: boolean;
  metrics: AgentMetrics | null;
  startRequest: (requestId: string, action: AgentAction, selectionProcessingMs?: number) => void;
  updateMetrics: (requestId: string, metrics: Partial<AgentMetrics>) => void;
  appendOutput: (requestId: string, chunk: string) => void;
  completeRequest: (requestId: string, fromCache?: boolean) => void;
  failRequest: (requestId: string, message: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  currentAction: null,
  output: '',
  isLoading: false,
  activeRequestId: null,
  error: null,
  fromCache: false,
  metrics: null,
  startRequest: (activeRequestId, currentAction, selectionProcessingMs = 0) => set({
    activeRequestId,
    currentAction,
    output: '',
    isLoading: true,
    error: null,
    fromCache: false,
    metrics: { cacheLookupMs: 0, cachedSegments: 0, firstTokenMs: null, segmentCount: 1, selectionProcessingMs, termHits: 0, totalMs: null },
  }),
  updateMetrics: (requestId, metrics) => set((state) => state.activeRequestId === requestId && state.metrics
    ? { metrics: { ...state.metrics, ...metrics } }
    : state),
  appendOutput: (requestId, chunk) => set((state) => state.activeRequestId === requestId ? { output: state.output + chunk } : state),
  completeRequest: (requestId, fromCache = false) => set((state) => state.activeRequestId === requestId ? { isLoading: false, fromCache } : state),
  failRequest: (requestId, error) => set((state) => state.activeRequestId === requestId ? { error, isLoading: false } : state),
}));
