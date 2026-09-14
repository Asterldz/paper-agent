import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { createProvider } from '@/services/llm/providerFactory';
import type { GraphModelPorts } from './literatureGraph';
import type { ModelConfig } from '@/types/settings';

export function createGraphModel(config: ModelConfig): GraphModelPorts {
  const baseURL = config.baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const deepseek = /deepseek/i.test(`${baseURL} ${config.model}`);
  const plannerOptions = {
    apiKey: config.apiKey.trim() || 'local-no-key', model: config.model.trim(),
    temperature: 0, maxTokens: 1536, maxRetries: 0, timeout: 45_000,
    streamUsage: false, useResponsesApi: false,
    ...(deepseek ? { modelKwargs: { thinking: { type: 'disabled' } } } : {}),
    configuration: { baseURL, dangerouslyAllowBrowser: true },
  };
  return {
    decide: async (messages, tools, signal) => {
      // Wiki proposals contain structured prose as tool arguments; keep the old
      // budget for environments without the drafting tool.
      const planner = new ChatOpenAI({ ...plannerOptions, maxTokens: tools.some((item) => item.name === 'propose_wiki_update') ? 4096 : 1536 });
      const result = await planner.bindTools(tools).invoke(messages, { signal });
      return new AIMessage({ content: result.content, tool_calls: result.tool_calls, invalid_tool_calls: result.invalid_tool_calls });
    },
    answer: (messages, signal) => createProvider({ ...config, maxTokens: Math.min(validLimit(config.maxTokens), 4096) }).chat(messages.map(toMessage), { signal, maxAttempts: 1, ...(deepseek ? { thinkingMode: 'disabled' as const } : {}) }),
  };
}

function validLimit(value?: number) { return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 2048; }

function toMessage(message: BaseMessage): { role: 'system' | 'user' | 'assistant'; content: string } {
  const type = message.type;
  return { role: type === 'system' ? 'system' : type === 'ai' ? 'assistant' : 'user', content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) };
}
