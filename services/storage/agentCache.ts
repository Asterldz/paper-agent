import type { AgentAction } from '@/types/agent';
import type { TextSelection } from '@/types/pdf';
import type { ModelConfig } from '@/types/settings';
import { READING_SKILL_VERSION } from '@/services/agent/skillPolicy';

const STORAGE_KEY = 'paper-agent-response-cache-v1';
const CACHE_VERSION = 'agent-prompts-2026-08-27-v24';
const MAX_ENTRIES = 80;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  key: string;
  output: string;
  createdAt: number;
  lastAccessedAt: number;
}

function readEntries(): CacheEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as CacheEntry[];
    const cutoff = Date.now() - MAX_AGE_MS;
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry?.key && entry?.output && entry.createdAt >= cutoff)
      : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: CacheEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      .slice(0, MAX_ENTRIES)));
  } catch {
    // Storage can be unavailable in private browsing; requests still work without caching.
  }
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createAgentCacheKey(options: {
  action: AgentAction | 'insights';
  model: ModelConfig;
  selection: TextSelection;
  question?: string;
  cacheContext?: string;
  skillContext?: string;
}): Promise<string> {
  return digest(JSON.stringify({
    version: CACHE_VERSION,
    skillVersion: READING_SKILL_VERSION,
    skillContext: options.skillContext ?? '',
    action: options.action,
    model: {
      provider: options.model.provider,
      baseUrl: options.model.baseUrl.trim().replace(/\/+$/, ''),
      model: options.model.model.trim(),
      temperature: options.model.temperature,
      maxTokens: options.model.maxTokens,
      translationThinkingMode: options.model.translationThinkingMode ?? 'disabled',
      insightsThinkingMode: options.model.insightsThinkingMode ?? 'enabled',
      insightsReasoningEffort: options.model.insightsReasoningEffort ?? 'low',
    },
    selectedText: options.selection.selectedText,
    surroundingText: options.selection.surroundingText,
    question: options.question?.trim() ?? '',
    cacheContext: options.cacheContext?.trim() ?? '',
  }));
}

export function getCachedAgentResponse(key: string): string | null {
  const entries = readEntries();
  const match = entries.find((entry) => entry.key === key);
  if (!match) {
    writeEntries(entries);
    return null;
  }
  match.lastAccessedAt = Date.now();
  writeEntries(entries);
  return match.output;
}

export function setCachedAgentResponse(key: string, output: string) {
  if (!output.trim()) return;
  const entries = readEntries().filter((entry) => entry.key !== key);
  const now = Date.now();
  entries.unshift({ key, output, createdAt: now, lastAccessedAt: now });
  writeEntries(entries);
}

export function clearAgentCache() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
}

export function getAgentCacheSize(): number {
  return readEntries().length;
}
