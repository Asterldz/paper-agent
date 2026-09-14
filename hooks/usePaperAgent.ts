'use client';

import { useCallback, useEffect, useRef } from 'react';
import { runAgent } from '@/services/agent/paperAgent';
import { readableLLMError } from '@/services/llm/errors';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { createAgentCacheKey, getCachedAgentResponse, setCachedAgentResponse } from '@/services/storage/agentCache';
import type { AgentAction } from '@/types/agent';
import type { TextSelection } from '@/types/pdf';
import { findRememberedTerms, getExactRememberedTerm, type TermMemoryEntry } from '@/services/storage/termMemory';
import { useAgentPolicyStore } from '@/stores/agentPolicyStore';

export function usePaperAgent() {
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const run = useCallback(async (selection: TextSelection, action: AgentAction, question?: string) => {
    controllerRef.current?.abort();
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const store = useAgentStore.getState();
    const settings = useSettingsStore.getState();
    const policySnapshot = useAgentPolicyStore.getState();
    const readingPolicy = { ...policySnapshot.policy };
    const skillContext = action === 'translate' ? '' : JSON.stringify([policySnapshot.revision, readingPolicy]);
    const preferredModelId = action === 'translate' ? settings.translationModelId ?? settings.activeModelId : settings.activeModelId;
    const model = settings.models.find((item) => item.id === preferredModelId)
      ?? settings.models.find((item) => item.id === settings.activeModelId);
    store.startRequest(requestId, action, selection.selectionProcessingMs);
    const exactRememberedTerm = action === 'translate' ? getExactRememberedTerm(selection.selectedText) : null;
    if (exactRememberedTerm) {
      const elapsed = performance.now() - startedAt;
      store.appendOutput(requestId, exactRememberedTerm.translation);
      store.updateMetrics(requestId, { cachedSegments: 1, firstTokenMs: elapsed, termHits: 1, totalMs: elapsed });
      store.completeRequest(requestId, true);
      return true;
    }
    if (!model) {
      store.failRequest(requestId, '请先点击顶部“配置模型”，添加并启用一个模型。');
      return false;
    }

    const requestModel = action === 'translate' ? fastTranslationModel(model, selection.selectedText) : model;
    const requestSelection = action === 'translate' ? { ...selection, surroundingText: compactTranslationContext(selection) } : selection;
    const rememberedTerms = action === 'translate' ? findRememberedTerms(requestSelection.selectedText) : [];
    store.updateMetrics(requestId, { termHits: rememberedTerms.length });
    const cacheStartedAt = performance.now();
    const cacheKey = await createAgentCacheKey({ action, skillContext, cacheContext: terminologyCacheKey(rememberedTerms), model: requestModel, selection: requestSelection, question });
    const cachedOutput = getCachedAgentResponse(cacheKey);
    let cacheLookupMs = performance.now() - cacheStartedAt;
    store.updateMetrics(requestId, { cacheLookupMs });
    if (cachedOutput) {
      const elapsed = performance.now() - startedAt;
      store.appendOutput(requestId, cachedOutput);
      store.updateMetrics(requestId, { cachedSegments: 1, firstTokenMs: elapsed, totalMs: elapsed });
      store.completeRequest(requestId, true);
      return true;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    const translationSegments = action === 'translate'
      ? segmentTranslationText(requestSelection.selectedText)
      : [{ text: requestSelection.selectedText, separatorBefore: '' }];
    store.updateMetrics(requestId, { segmentCount: translationSegments.length });
    let completeOutput = '';
    let pendingOutput = '';
    let paintFrame: number | null = null;
    let receivedFirstChunk = false;
    let cachedSegments = 0;
    const flushOutput = () => {
      if (!pendingOutput) return;
      useAgentStore.getState().appendOutput(requestId, pendingOutput);
      pendingOutput = '';
      paintFrame = null;
    };
    const appendChunk = (chunk: string) => {
      const displayChunk = action === 'translate' ? chunk.replace(/\r?\n+/g, '') : chunk;
      if (!displayChunk) return;
      completeOutput += displayChunk;
      if (!receivedFirstChunk) {
        receivedFirstChunk = true;
        useAgentStore.getState().updateMetrics(requestId, { firstTokenMs: performance.now() - startedAt });
        useAgentStore.getState().appendOutput(requestId, displayChunk);
      } else {
        pendingOutput += displayChunk;
        paintFrame ??= window.requestAnimationFrame(flushOutput);
      }
    };
    try {
      for (let index = 0; index < translationSegments.length; index += 1) {
        const { text: segmentText, separatorBefore } = translationSegments[index];
        const segmented = action === 'translate' && translationSegments.length > 1;
        const segmentSelection = segmented ? { ...requestSelection, selectedText: segmentText, surroundingText: '' } : requestSelection;
        const segmentModel = segmented ? fastTranslationModel(model, segmentText) : requestModel;
        const segmentTerms = segmented ? rememberedTerms.filter((term) => includesTerm(segmentText, term.term)) : rememberedTerms;
        let segmentCacheKey = cacheKey;
        let segmentCachedOutput: string | null = null;
        if (segmented) {
          const segmentCacheStartedAt = performance.now();
          segmentCacheKey = await createAgentCacheKey({ action, skillContext, cacheContext: terminologyCacheKey(segmentTerms), model: segmentModel, selection: segmentSelection, question });
          segmentCachedOutput = getCachedAgentResponse(segmentCacheKey);
          cacheLookupMs += performance.now() - segmentCacheStartedAt;
          useAgentStore.getState().updateMetrics(requestId, { cacheLookupMs });
        }
        if (separatorBefore) appendChunk(separatorBefore);
        if (segmentCachedOutput) {
          cachedSegments += 1;
          useAgentStore.getState().updateMetrics(requestId, { cachedSegments });
          appendChunk(segmentCachedOutput);
          continue;
        }

        let segmentOutput = '';
        for await (const chunk of runAgent({
          action,
          context: {
            readingPolicy,
            pageNumber: selection.pageNumber,
            selectedText: segmentSelection.selectedText,
            surroundingText: segmentSelection.surroundingText,
            terminologyHints: segmentTerms.map(({ term, translation }) => ({ term, translation })),
            question,
          },
          model: segmentModel,
          signal: controller.signal,
        })) {
          segmentOutput += chunk;
          appendChunk(chunk);
        }
        if (segmented) setCachedAgentResponse(segmentCacheKey, segmentOutput);
      }
      if (paintFrame !== null) window.cancelAnimationFrame(paintFrame);
      flushOutput();
      setCachedAgentResponse(cacheKey, completeOutput);
      useAgentStore.getState().updateMetrics(requestId, { cachedSegments, totalMs: performance.now() - startedAt });
      useAgentStore.getState().completeRequest(requestId, cachedSegments === translationSegments.length);
      return true;
    } catch (reason: unknown) {
      if (paintFrame !== null) window.cancelAnimationFrame(paintFrame);
      flushOutput();
      if (reason instanceof DOMException && reason.name === 'AbortError') return false;
      useAgentStore.getState().updateMetrics(requestId, { totalMs: performance.now() - startedAt });
      useAgentStore.getState().failRequest(requestId, readableLLMError(reason));
      return false;
    }
  }, []);

  return { run, cancel };
}

interface TranslationSegment {
  text: string;
  separatorBefore: string;
}

function segmentTranslationText(text: string): TranslationSegment[] {
  const normalized = text.trim();
  const paragraphs = normalized.split(/\n\s*\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (normalized.length <= 700 && paragraphs.length <= 1) return [{ text: normalized, separatorBefore: '' }];
  const segments: TranslationSegment[] = [];
  for (const paragraph of paragraphs) {
    const chunks = segmentParagraph(paragraph);
    chunks.forEach((chunk) => segments.push({
      text: chunk,
      separatorBefore: '',
    }));
  }
  return segments.length ? segments : [{ text: normalized, separatorBefore: '' }];
}

function segmentParagraph(paragraph: string): string[] {
  const sentenceSegments = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(paragraph), (part) => part.segment.trim()).filter(Boolean)
    : paragraph.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const pieces = sentenceSegments.flatMap((sentence) => splitOversizeSegment(sentence, 620));
  const groups: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!current || current.length + piece.length + 1 <= 620) current = current ? `${current} ${piece}` : piece;
    else {
      groups.push(current);
      current = piece;
    }
  }
  if (current) groups.push(current);
  return groups.length ? groups : [paragraph];
}

function splitOversizeSegment(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength);
    const splitAt = Math.max(candidate.lastIndexOf('; '), candidate.lastIndexOf(', '), candidate.lastIndexOf(' '));
    const safeSplit = splitAt >= Math.floor(maxLength * 0.55) ? splitAt + 1 : maxLength;
    pieces.push(remaining.slice(0, safeSplit).trim());
    remaining = remaining.slice(safeSplit).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

function terminologyCacheKey(terms: TermMemoryEntry[]) {
  return `translation-continuous-v1|${terms.map((term) => `${term.term}=>${term.translation}`).join('|')}`;
}

function includesTerm(text: string, term: string) {
  return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

function compactTranslationContext(selection: TextSelection): string {
  if (selection.selectedText.length >= 100) return '';
  const context = selection.surroundingText;
  if (context.length <= 240) return context;
  const selectedIndex = context.toLocaleLowerCase().indexOf(selection.selectedText.toLocaleLowerCase());
  if (selectedIndex < 0) return context.slice(0, 240);
  const start = Math.max(0, selectedIndex - 80);
  const end = Math.min(context.length, selectedIndex + selection.selectedText.length + 80);
  return context.slice(start, end);
}

function fastTranslationModel(model: import('@/types/settings').ModelConfig, selectedText: string): import('@/types/settings').ModelConfig {
  const estimatedTokens = Math.max(256, Math.ceil(selectedText.length * 0.9) + 96);
  const configuredLimit = model.maxTokens ?? 2048;
  const maxTokens = isLikelyReasoningModel(model.model)
    ? Math.max(configuredLimit, 4096)
    : Math.max(256, Math.min(configuredLimit, estimatedTokens));
  return {
    ...model,
    temperature: Math.min(model.temperature, 0.1),
    maxTokens,
  };
}

function isLikelyReasoningModel(modelName: string): boolean {
  const normalized = modelName.trim().toLocaleLowerCase();
  return normalized.includes('reasoner')
    || normalized.includes('thinking')
    || /(^|[\/_-])(?:deepseek-)?r1($|[\/_-])/.test(normalized)
    || /(^|[\/_-])qwq($|[\/_-])/.test(normalized)
    || /(^|[\/_-])o[134]($|[\/_-])/.test(normalized);
}
