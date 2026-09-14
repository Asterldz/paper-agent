import type { Message } from './llm';

export type AgentAction = 'translate' | 'explain' | 'summarize' | 'term' | 'ask';

export interface AgentContext {
  readingPolicy?: import('./agentRuntime').ReadingPolicy;
  paperTitle?: string;
  pageNumber?: number;
  selectedText?: string;
  surroundingText?: string;
  pageText?: string;
  conversationHistory?: Message[];
  question?: string;
  terminologyHints?: Array<{ term: string; translation: string }>;
}
