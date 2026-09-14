import { LLMError, messageForStatus } from './errors';
import type { ChatOptions, LLMProvider, Message } from '@/types/llm';
import type { ModelConfig } from '@/types/settings';

interface ContentPart { text?: string | null; content?: string | null }

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | ContentPart[] | null; reasoning?: string | null; reasoning_content?: string | null };
    message?: { content?: string | ContentPart[] | null; reasoning_content?: string | null };
    text?: string | null;
  }>;
  output_text?: string | null;
  output?: Array<{ content?: ContentPart[] }>;
}

class ReasoningOnlyResponseError extends Error {}
class UnsupportedThinkingParametersError extends Error {}
class InvalidMaxTokensError extends Error {
  constructor(readonly supportedMaximum: number) {
    super('Invalid max_tokens value');
  }
}

const REASONING_RETRY_MIN_TOKENS = 4096;
const REASONING_RETRY_MAX_TOKENS = 16384;
export const OPENAI_COMPATIBLE_MAX_TOKENS = 393216;

function endpointFor(baseUrl: string): string {
  const cleaned = baseUrl.trim().replace(/\/+$/, '');
  if (!cleaned) throw new LLMError('请填写有效的 Base URL。');
  try {
    const parsed = new URL(cleaned);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new LLMError('Base URL 格式无效，请填写完整的 http:// 或 https:// 地址。');
  }
  return cleaned.endsWith('/chat/completions') ? cleaned : `${cleaned}/chat/completions`;
}

function textFromContent(content: string | ContentPart[] | null | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => part.text ?? part.content ?? '').join('');
}

function contentFromPayload(payload: ChatCompletionChunk): string {
  const choice = payload.choices?.[0];
  return textFromContent(choice?.delta?.content)
    || textFromContent(choice?.message?.content)
    || choice?.text
    || payload.output_text
    || payload.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? part.content ?? '').join('')
    || '';
}

function hasReasoning(payload: ChatCompletionChunk): boolean {
  const choice = payload.choices?.[0];
  return Boolean(choice?.delta?.reasoning_content || choice?.delta?.reasoning || choice?.message?.reasoning_content);
}

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(private readonly config: ModelConfig) {}

  async *chat(messages: Message[], options?: ChatOptions): AsyncIterable<string> {
    let requestMessages = messages;
    let maxTokens = this.config.maxTokens;
    let thinkingMode = options?.thinkingMode;
    let reasoningEffort = options?.reasoningEffort;
    let reasoningRetried = false;

    const maxAttempts = Math.max(1, Math.min(4, Math.floor(options?.maxAttempts ?? 4)));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        yield* this.streamOnce(requestMessages, maxTokens, thinkingMode, reasoningEffort, options);
        return;
      } catch (reason: unknown) {
        if (reason instanceof InvalidMaxTokensError) {
          if (attempt + 1 >= maxAttempts) throw new LLMError(`接口拒绝了 Max Tokens 参数，支持的最大值为 ${reason.supportedMaximum}。请调整模型设置。`);
          maxTokens = Math.min(positiveInteger(maxTokens) ?? reason.supportedMaximum, reason.supportedMaximum);
          continue;
        }
        if (reason instanceof UnsupportedThinkingParametersError && thinkingMode) {
          if (attempt + 1 >= maxAttempts) throw new LLMError('当前接口拒绝了思考模式参数，请检查接口兼容性。');
          thinkingMode = undefined;
          reasoningEffort = undefined;
          continue;
        }
        if (!(reason instanceof ReasoningOnlyResponseError)) throw reason;
        if (attempt + 1 >= maxAttempts) throw new LLMError('模型只返回了推理内容，没有返回可见正文。请检查思考模式和 Max Tokens；这不代表模型不支持工具调用。');
        if (reasoningRetried) {
          throw new LLMError('推理模型仍未生成正文。请改用非推理模型，或在模型设置中继续提高 Max Tokens。');
        }
        reasoningRetried = true;
        maxTokens = reasoningRetryBudget(maxTokens);
        requestMessages = [
          ...messages,
          { role: 'user', content: '上一轮未生成可见正文。请立即只输出最终答案正文，不要展示推理过程。' },
        ];
      }
    }
    throw new LLMError('模型未生成正文，请换用非推理模型后重试。');
  }

  private async *streamOnce(
    messages: Message[],
    maxTokens: number | undefined,
    thinkingMode: ChatOptions['thinkingMode'],
    reasoningEffort: ChatOptions['reasoningEffort'],
    options?: ChatOptions,
  ): AsyncIterable<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey.trim()) headers.Authorization = `Bearer ${this.config.apiKey.trim()}`;
    const safeMaxTokens = positiveInteger(maxTokens);
    const safeTemperature = finiteNumber(this.config.temperature);

    const response = await fetch(endpointFor(this.config.baseUrl), {
      method: 'POST',
      headers,
      signal: options?.signal,
      body: JSON.stringify({
        model: this.config.model.trim(),
        messages,
        stream: true,
        ...(safeTemperature !== undefined ? { temperature: safeTemperature } : {}),
        ...(safeMaxTokens !== undefined ? { max_tokens: safeMaxTokens } : {}),
        ...(thinkingMode ? { thinking: { type: thinkingMode } } : {}),
        ...(thinkingMode === 'enabled' && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await apiErrorDetail(response);
      const supportedMaximum = maxTokensMaximumFromError(detail);
      if ((response.status === 400 || response.status === 422) && supportedMaximum !== undefined) {
        throw new InvalidMaxTokensError(supportedMaximum);
      }
      if (thinkingMode && (response.status === 400 || response.status === 422)) {
        throw new UnsupportedThinkingParametersError();
      }
      const message = detail && (response.status === 400 || response.status === 422)
        ? `接口拒绝了请求（HTTP ${response.status}）：${detail}`
        : messageForStatus(response.status, this.config.model);
      throw new LLMError(message, response.status);
    }
    if (!response.body) throw new LLMError('模型返回了空响应。');

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') && contentType.includes('application/json')) {
      const payload = await response.json() as ChatCompletionChunk;
      const content = contentFromPayload(payload);
      if (!content && hasReasoning(payload)) throw new ReasoningOnlyResponseError();
      if (!content) throw new LLMError('模型返回了空内容。请检查模型名称和 OpenAI Compatible 接口格式。');
      yield content;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let received = false;
    let reasoningReceived = false;

    const parseLine = (line: string): string => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '[DONE]' || trimmed.startsWith(':') || trimmed.startsWith('event:')) return '';
      const data = trimmed.replace(/^data:\s*/, '');
      if (!data || data === '[DONE]') return '';
      try {
        const payload = JSON.parse(data) as ChatCompletionChunk;
        reasoningReceived ||= hasReasoning(payload);
        return contentFromPayload(payload);
      } catch {
        return '';
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const content = parseLine(line);
        if (content) { received = true; yield content; }
      }
      if (done) break;
    }
    const finalContent = parseLine(buffer);
    if (finalContent) { received = true; yield finalContent; }
    if (!received && reasoningReceived) {
      throw new ReasoningOnlyResponseError();
    }
    if (!received) throw new LLMError('模型返回了空内容。请检查模型名称和 OpenAI Compatible 接口格式。');
  }
}

function reasoningRetryBudget(current: number | undefined): number {
  const base = Number.isFinite(current) && (current ?? 0) > 0 ? current as number : 0;
  return Math.min(REASONING_RETRY_MAX_TOKENS, Math.max(REASONING_RETRY_MIN_TOKENS, base * 4));
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return undefined;
  return Math.min(Math.floor(value), OPENAI_COMPATIBLE_MAX_TOKENS);
}

function maxTokensMaximumFromError(detail: string): number | undefined {
  if (!/max[_ ]tokens/i.test(detail)) return undefined;
  const range = detail.match(/range\s+(?:of\s+max[_ ]tokens\s+)?is\s*\[\s*\d+\s*,\s*(\d+)\s*\]/i)
    ?? detail.match(/max[_ ]tokens[^\d]+\[\s*\d+\s*,\s*(\d+)\s*\]/i);
  if (!range) return undefined;
  const maximum = Number(range[1]);
  return Number.isFinite(maximum) && maximum >= 1 ? Math.floor(maximum) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function apiErrorDetail(response: Response): Promise<string> {
  try {
    const raw = await response.text();
    if (!raw) return '';
    let message = raw;
    try {
      const payload = JSON.parse(raw) as { detail?: string; error?: { message?: string } | string; message?: string };
      message = typeof payload.error === 'string'
        ? payload.error
        : payload.error?.message ?? payload.message ?? payload.detail ?? raw;
    } catch {
      // Some compatible APIs return a plain-text error body.
    }
    return message.replace(/\s+/g, ' ').trim().slice(0, 240);
  } catch {
    return '';
  }
}
