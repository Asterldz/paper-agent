import type { ReadingPolicy } from '@/types/agentRuntime';

export const READING_SKILL_VERSION = 'paper-reading-1.2.0';
export const EVOLUTION_SKILL_VERSION = 'paper-reading-evolution-1.0.0';
export const DEFAULT_READING_POLICY: ReadingPolicy = {
  answerStyle: 'structured', referenceDepth: 'when-needed', termDetail: 'brief',
};

// These are host-enforced slots, not permissions editable by an evolving prompt.
const VALUES = {
  answerStyle: ['concise', 'structured'],
  referenceDepth: ['when-needed', 'prefer-primary'],
  termDetail: ['brief', 'extended'],
} as const;

export function isPolicyPatch(value: unknown): value is Partial<ReadingPolicy> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 3 && entries.every(([key, item]) =>
    Object.hasOwn(VALUES, key) && (VALUES[key as keyof ReadingPolicy] as readonly unknown[]).includes(item));
}

export function normalizePolicy(value: unknown): ReadingPolicy {
  if (!value || typeof value !== 'object') return { ...DEFAULT_READING_POLICY };
  const result = { ...DEFAULT_READING_POLICY };
  for (const key of Object.keys(VALUES) as Array<keyof ReadingPolicy>) {
    const item = (value as Record<string, unknown>)[key];
    if ((VALUES[key] as readonly unknown[]).includes(item)) Object.assign(result, { [key]: item });
  }
  return result;
}

export function policyInstructions(policy: ReadingPolicy): string {
  return [
    policy.answerStyle === 'concise' ? '回答简洁，先给直接结论，必要时才展开。' : '长解释和总结按逻辑分段；短问题直接回答，避免固定模板。',
    policy.referenceDepth === 'prefer-primary' ? '问题涉及被引用的方法或结论时，优先追踪参考原文；原文不可用则说明，不能把题录当全文。' : '证据缺口或用户要求核查来源时追踪参考原文，不为无关问题额外查参考文献。',
    policy.termDetail === 'extended' ? '术语解释可补充有助于理解的关联概念，明确这些是延伸知识。' : '术语解释紧扣当前语境，避免不必要扩展。',
    '翻译仍输出连续正文，保留符号与数据。这里的回答风格不覆盖用户当前请求和已保存的模型思考设置。',
  ].join('\n');
}
