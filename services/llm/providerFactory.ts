import { OpenAICompatibleProvider } from './openaiCompatible';
import type { LLMProvider } from '@/types/llm';
import type { ModelConfig } from '@/types/settings';

export function createProvider(config: ModelConfig): LLMProvider {
  switch (config.provider) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
  }
}
