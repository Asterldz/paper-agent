'use client';

import { useCallback, useEffect, useRef } from 'react';
import { runInsightsAgent } from '@/services/agent/insightsAgent';
import { readableLLMError } from '@/services/llm/errors';
import { useInsightsStore } from '@/stores/insightsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { TextSelection } from '@/types/pdf';
import { createAgentCacheKey, getCachedAgentResponse, setCachedAgentResponse } from '@/services/storage/agentCache';
import { rememberTermsFromInsights } from '@/services/storage/termMemory';

export function useSelectionInsights() {
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const queue = useCallback((selectionId: string) => {
    controllerRef.current?.abort();
    useInsightsStore.getState().queue(selectionId);
  }, []);

  const run = useCallback(async (selection: TextSelection) => {
    controllerRef.current?.abort();
    const settings = useSettingsStore.getState();
    const model = settings.models.find((item) => item.id === settings.activeModelId);
    if (!model) return false;

    const cacheKey = await createAgentCacheKey({ action: 'insights', model, selection });
    const cachedOutput = getCachedAgentResponse(cacheKey);
    if (cachedOutput) {
      const store = useInsightsStore.getState();
      store.startRequest(selection.id);
      store.appendOutput(selection.id, cachedOutput);
      rememberTermsFromInsights(cachedOutput);
      store.completeRequest(selection.id, true);
      return true;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    const store = useInsightsStore.getState();
    store.startRequest(selection.id);
    let completeOutput = '';
    try {
      for await (const chunk of runInsightsAgent({ selection, model, signal: controller.signal })) {
        completeOutput += chunk;
        useInsightsStore.getState().appendOutput(selection.id, chunk);
      }
      setCachedAgentResponse(cacheKey, completeOutput);
      rememberTermsFromInsights(completeOutput);
      useInsightsStore.getState().completeRequest(selection.id);
      return true;
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return false;
      useInsightsStore.getState().failRequest(selection.id, readableLLMError(reason));
      return false;
    }
  }, []);

  return { queue, run };
}
