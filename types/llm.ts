export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxAttempts?: number;
  reasoningEffort?: 'none' | 'low' | 'high' | 'max';
  signal?: AbortSignal;
  thinkingMode?: 'enabled' | 'disabled';
}

export interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): AsyncIterable<string>;
}
