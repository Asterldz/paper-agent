import type { ReadingPolicy, SkillCandidate } from '@/types/agentRuntime';
import { isPolicyPatch } from './skillPolicy';

export function explicitFeedback(feedback: string): { kind: SkillCandidate['kind']; patch: Partial<ReadingPolicy>; reason: string } | null {
  if (/HTTP\s*400|(?:max[_ ]?tokens)|画线|划线|分栏|页眉|变黄|选区|卡顿|加载失败|无法打开/i.test(feedback)) {
    return { kind: 'engineering', patch: {}, reason: '这是 PDF、界面或接口故障，应修复代码并增加回归用例，不自动修改阅读策略。' };
  }
  if (/这次|这一次|本次|临时/.test(feedback)) return { kind: 'unclear', patch: {}, reason: '这是单次要求，不写入长期阅读策略。请在普通对话中提出本次要求。' };
  if (!/以后|今后|下次|记住|始终/.test(feedback)) return null;
  // Exact, narrowly scoped patterns are the only automatic promotion path.
  if (/^(?:以后|今后|下次)(?:请)?(?:都)?(?:回答|解释)(?:请)?(?:更)?(?:简短|简洁)(?:一点)?[。！!]?$/u.test(feedback.trim())) {
    return { kind: 'preference', patch: { answerStyle: 'concise' }, reason: '明确长期偏好：回答更简洁；不改变引用规则、翻译分段或模型设置。' };
  }
  if (/^(?:以后|今后|下次)(?:请)?(?:都)?(?:回答|解释)(?:请)?(?:分段|有条理)(?:一点)?[。！!]?$/u.test(feedback.trim())) {
    return { kind: 'preference', patch: { answerStyle: 'structured' }, reason: '明确长期偏好：解释按逻辑分段；不改变译文连续正文。' };
  }
  return null;
}

export function canAutoApply(candidate: SkillCandidate, revision: number): boolean {
  if (candidate.parentRevision !== revision || candidate.kind !== 'preference' || candidate.status !== 'pending' || !isPolicyPatch(candidate.patch)) return false;
  const explicit = explicitFeedback(candidate.feedback);
  return explicit?.kind === 'preference' && JSON.stringify(explicit.patch) === JSON.stringify(candidate.patch);
}

export function guardEvolutionProposal(value: unknown): { kind: SkillCandidate['kind']; patch: Partial<ReadingPolicy>; reason: string } {
  const fallback = { kind: 'unclear' as const, patch: {}, reason: '未形成可安全应用的修改；当前版本保持不变。' };
  if (!value || typeof value !== 'object') return fallback;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['kind', 'patch', 'reason'].includes(key))) return fallback;
  if (typeof input.reason !== 'string' || input.reason.length > 600) return fallback;
  if (input.kind === 'engineering' || input.kind === 'unclear') return { kind: input.kind, patch: {}, reason: input.reason };
  if (!['preference', 'strategy'].includes(String(input.kind)) || !isPolicyPatch(input.patch) || Object.keys(input.patch).length !== 1) return fallback;
  // Model proposals remain strategy candidates for human review, even if labeled personal preference.
  return { kind: 'strategy', patch: input.patch, reason: input.reason };
}
