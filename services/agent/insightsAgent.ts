import { createProvider } from '@/services/llm/providerFactory';
import type { Message } from '@/types/llm';
import type { TextSelection } from '@/types/pdf';
import type { ModelConfig } from '@/types/settings';

const INSIGHTS_SYSTEM_PROMPT = `你是一名严谨的学术论文伴读助手。根据用户划选的内容和上下文，提取最多 4 个确实相关的专业术语，并给出简洁中文解释；再给出 2～3 条有助于理解论文的相关联想，例如相关理论、方法、研究问题或实际应用。
要求：不要复述或翻译原文；不要虚构论文结论；联想必须标明是理解线索而非原文观点；如果没有明显术语，明确写“本段无须额外解释的专有名词”。
严格使用以下纯文本格式，不要添加其他标题：
【专有名词】
• 英文术语（常用中文译名）：一句解释
【相关联想】
• 一条简洁的理解线索`;

export function runInsightsAgent(options: {
  selection: TextSelection;
  model: ModelConfig;
  signal: AbortSignal;
}): AsyncIterable<string> {
  const selectedText = compactText(options.selection.selectedText, 2800);
  const surroundingText = compactSurroundingText(options.selection.surroundingText, selectedText);
  const provider = createProvider({
    ...options.model,
    temperature: Math.min(options.model.temperature, 0.35),
    maxTokens: Math.max(640, Math.min(options.model.maxTokens ?? 1024, 1024)),
  });
  const messages: Message[] = [
    { role: 'system', content: INSIGHTS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${surroundingText ? `<context>\n${surroundingText}\n</context>\n\n` : ''}<selected_text>\n${selectedText}\n</selected_text>`,
    },
  ];
  const thinkingMode = options.model.insightsThinkingMode ?? 'enabled';
  return provider.chat(messages, {
    reasoningEffort: thinkingMode === 'enabled' ? options.model.insightsReasoningEffort ?? 'low' : undefined,
    signal: options.signal,
    thinkingMode: thinkingMode === 'auto' ? undefined : thinkingMode,
  });
}

function compactText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const sideLength = Math.floor((maxLength - 5) / 2);
  return `${normalized.slice(0, sideLength)} … ${normalized.slice(-sideLength)}`;
}

function compactSurroundingText(context: string, selectedText: string): string {
  const normalized = context.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === selectedText) return '';
  return compactText(normalized, 900);
}
