'use client';

import { useCallback, useEffect, useRef } from 'react';
import { readableLLMError } from '@/services/llm/errors';
import { usePaperChatStore } from '@/stores/paperChatStore';
import { useReaderStore } from '@/stores/readerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAgentPolicyStore } from '@/stores/agentPolicyStore';
import { listLibraryDocuments, loadLibraryDocumentIndex } from '@/services/storage/documentLibrary';
import { findRememberedTerms } from '@/services/storage/termMemory';
import { externalPapers } from '@/services/agent/externalPapers';
import { wikiLibrary } from '@/services/storage/wikiLibrary';

export function usePaperAssistant(activeDocumentId: string | null) {
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), [activeDocumentId]);

  const ask = useCallback(async (question: string) => {
    controllerRef.current?.abort();
    const reader = useReaderStore.getState();
    const settings = useSettingsStore.getState();
    const model = settings.models.find((item) => item.id === settings.activeModelId);
    if (!model) return false;
    const chat = usePaperChatStore.getState();
    const history = chat.messages.filter((message) => message.id !== 'paper-assistant-welcome' && message.content.trim());
    const responseId = crypto.randomUUID();
    chat.startRequest(question, responseId);
    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 150_000);
    try {
      // Keep the orchestration framework out of the PDF selection/translation path.
      const [{ runLiteratureGraph }, { createGraphModel }, { READING_SKILL }] = await Promise.all([
        import('@/services/agent/literatureGraph'), import('@/services/agent/langchainModel'), import('@/services/agent/skills'),
      ]);
      await useAgentPolicyStore.persist.rehydrate();
      controller.signal.throwIfAborted();
      const snapshot = useAgentPolicyStore.getState();
      const result = await runLiteratureGraph({
        env: { documentId: activeDocumentId ?? 'current-document', title: reader.fileName || '当前论文', pages: reader.documentPages,
          selection: reader.activeSelection, listDocuments: listLibraryDocuments, loadPages: loadLibraryDocumentIndex,
          lookupTerms: (text) => findRememberedTerms(text, 6), signal: controller.signal, external: externalPapers, wiki: wikiLibrary },
        question, history, skill: READING_SKILL, policy: { ...snapshot.policy }, revision: snapshot.revision,
        runId: responseId, model: createGraphModel(model),
        onChunk: (chunk) => usePaperChatStore.getState().appendResponse(responseId, chunk),
        onEvent: (event) => usePaperChatStore.getState().addTrace(responseId, event),
      });
      controller.signal.throwIfAborted();
      usePaperChatStore.getState().finishAgent(responseId, result.content, result.report);
      return true;
    } catch (reason: unknown) {
      if (controller.signal.aborted && !timedOut) { usePaperChatStore.getState().completeRequest(responseId); return false; }
      usePaperChatStore.getState().failRequest(responseId, timedOut ? '本次任务达到 150 秒上限，已停止。可以缩小问题后重试。'
        : readableLLMError(reason));
      return false;
    } finally { window.clearTimeout(timeout); }
  }, [activeDocumentId]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  return { ask, cancel };
}
