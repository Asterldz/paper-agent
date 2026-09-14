import { buildMessages } from './promptBuilder';
import { createProvider } from '@/services/llm/providerFactory';
import type { AgentAction, AgentContext } from '@/types/agent';
import type { ModelConfig } from '@/types/settings';

export function runAgent(options: {
  action: AgentAction;
  context: AgentContext;
  model: ModelConfig;
  signal: AbortSignal;
}): AsyncIterable<string> {
  const provider = createProvider(options.model);
  const translationThinkingMode = options.model.translationThinkingMode ?? 'disabled';
  return provider.chat(buildMessages(options.action, options.context), {
    signal: options.signal,
    thinkingMode: options.action === 'translate' && translationThinkingMode !== 'auto'
      ? translationThinkingMode
      : undefined,
  });
}
