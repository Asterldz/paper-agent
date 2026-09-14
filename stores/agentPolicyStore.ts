'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_READING_POLICY, isPolicyPatch, normalizePolicy } from '@/services/agent/skillPolicy';
import type { ReadingPolicy, SkillCandidate } from '@/types/agentRuntime';

interface PolicyVersion { revision: number; policy: ReadingPolicy; reason: string; createdAt: number }
interface PolicyState {
  policy: ReadingPolicy;
  revision: number;
  autoPreferences: boolean;
  candidates: SkillCandidate[];
  history: PolicyVersion[];
  setAutoPreferences: (enabled: boolean) => void;
  propose: (candidate: SkillCandidate) => void;
  apply: (candidateId: string) => boolean;
  reject: (candidateId: string) => void;
  rollback: () => void;
}

export const useAgentPolicyStore = create<PolicyState>()(persist((set, get) => ({
  policy: { ...DEFAULT_READING_POLICY }, revision: 0, autoPreferences: false, candidates: [], history: [],
  setAutoPreferences: (autoPreferences) => set({ autoPreferences }),
  propose: (candidate) => set((state) => ({
    candidates: [candidate, ...state.candidates.filter((item) => item.id !== candidate.id)].slice(0, 30),
  })),
  apply: (candidateId) => {
    const state = get();
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== 'pending' || candidate.parentRevision !== state.revision
      || !['preference', 'strategy'].includes(candidate.kind) || !isPolicyPatch(candidate.patch)) return false;
    const policy = { ...state.policy, ...candidate.patch };
    set({
      policy, revision: state.revision + 1,
      history: [...state.history, { revision: state.revision, policy: state.policy, reason: candidate.reason, createdAt: Date.now() }].slice(-20),
      candidates: state.candidates.map((item) => item.id === candidateId ? { ...item, status: 'applied' } : item),
    });
    return true;
  },
  reject: (candidateId) => set((state) => ({ candidates: state.candidates.map((item) => item.id === candidateId ? { ...item, status: 'rejected' } : item) })),
  rollback: () => set((state) => {
    const previous = state.history.at(-1);
    if (!previous) return state;
    return { policy: previous.policy, revision: state.revision + 1, history: state.history.slice(0, -1) };
  }),
}), {
  name: 'paper-agent-skill-policy-v1',
  // Do not allow persisted fields to replace actions or host policy validators.
  merge: (persisted, current) => {
    const value = (persisted ?? {}) as Partial<PolicyState>;
    return {
      ...current, policy: normalizePolicy(value.policy),
      revision: Number.isSafeInteger(value.revision) && (value.revision ?? -1) >= 0 ? value.revision! : 0,
      autoPreferences: value.autoPreferences === true,
      candidates: Array.isArray(value.candidates) ? value.candidates.filter((item) => item && typeof item.id === 'string' && typeof item.reason === 'string' && typeof item.feedback === 'string' && item.patch && typeof item.patch === 'object' && !Array.isArray(item.patch) && ['pending', 'applied', 'rejected'].includes(item.status)).slice(0, 30) : [],
      history: Array.isArray(value.history) ? value.history.filter((item) => item && Number.isSafeInteger(item.revision)).slice(-20).map((item) => ({ ...item, policy: normalizePolicy(item.policy) })) : [],
    };
  },
}));

// Serialize read/modify/write across App tabs. Unsupported browsers stay in manual mode.
export async function withPolicyLock<T>(action: () => T | Promise<T>): Promise<T> {
  const run = async () => { await useAgentPolicyStore.persist.rehydrate(); return action(); };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('paper-agent-policy', run);
  return run();
}
