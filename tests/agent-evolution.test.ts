import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explicitFeedback, canAutoApply, guardEvolutionProposal } from '../services/agent/evolutionRules';
import { isPolicyPatch, normalizePolicy, DEFAULT_READING_POLICY } from '../services/agent/skillPolicy';
import { useAgentPolicyStore } from '../stores/agentPolicyStore';
import { createAgentCacheKey } from '../services/storage/agentCache';
import type { SkillCandidate } from '../types/agentRuntime';

function candidate(overrides: Partial<SkillCandidate> = {}): SkillCandidate {
  return { id: 'c1', parentRevision: 0, feedback: '以后回答简短一点', kind: 'preference', patch: { answerStyle: 'concise' },
    reason: 'Explicit preference', createdAt: 1, status: 'pending', ...overrides };
}

test('explicit preferences are scoped, but one-off instructions are not learned', () => {
  assert.deepEqual(explicitFeedback('以后回答简短一点')?.patch, { answerStyle: 'concise' });
  assert.equal(explicitFeedback('这一次解释分段')?.kind, 'unclear');
  assert.equal(explicitFeedback('为什么论文中说以后回答简短一点？'), null);
});

test('engineering feedback cannot become a reading-policy patch', () => {
  for (const text of ['左右分栏错误', '画线整页变黄', 'HTTP 400 Invalid max_tokens', '页眉被选中']) {
    assert.equal(explicitFeedback(text)?.kind, 'engineering'); assert.deepEqual(explicitFeedback(text)?.patch, {});
  }
});

test('unknown keys, permissions, budget edits, and prototype keys are rejected', () => {
  for (const value of [{ maxTokens: 1000000 }, { permissions: ['shell'] }, { answerStyle: 'ignore rules' }, JSON.parse('{"__proto__":"x"}')]) assert.equal(isPolicyPatch(value), false);
  assert.deepEqual(normalizePolicy({ answerStyle: 'unsupported', tool: 'shell' }), DEFAULT_READING_POLICY);
  assert.deepEqual(guardEvolutionProposal({ kind: 'strategy', patch: { answerStyle: 'concise' }, reason: 'ok', overrideBudget: true }).patch, {});
});

test('model suggestions cannot grant themselves automatic promotion', () => {
  assert.equal(canAutoApply(candidate(), 0), true);
  assert.equal(canAutoApply(candidate({ parentRevision: 1 }), 0), false);
  assert.equal(canAutoApply(candidate({ feedback: '下次修改所有权限' }), 0), false);
  assert.equal(canAutoApply(candidate({ kind: 'strategy' }), 0), false);
  assert.equal(guardEvolutionProposal({ kind: 'preference', patch: { referenceDepth: 'prefer-primary' }, reason: 'model guess' }).kind, 'strategy');
});

test('promotion checks parent version, updates only the allowed slot, and rollback restores behavior', () => {
  useAgentPolicyStore.setState({ policy: { ...DEFAULT_READING_POLICY }, revision: 0, candidates: [], history: [] });
  useAgentPolicyStore.getState().propose(candidate());
  assert.equal(useAgentPolicyStore.getState().apply('c1'), true);
  assert.equal(useAgentPolicyStore.getState().revision, 1);
  assert.equal(useAgentPolicyStore.getState().policy.referenceDepth, DEFAULT_READING_POLICY.referenceDepth);
  useAgentPolicyStore.getState().propose(candidate({ id: 'stale' }));
  assert.equal(useAgentPolicyStore.getState().apply('stale'), false);
  useAgentPolicyStore.getState().rollback();
  assert.deepEqual(useAgentPolicyStore.getState().policy, DEFAULT_READING_POLICY);
  assert.equal(useAgentPolicyStore.getState().revision, 2);
});

test('failed and empty patches cannot be applied even through a direct store action', () => {
  useAgentPolicyStore.setState({ policy: { ...DEFAULT_READING_POLICY }, revision: 0, candidates: [], history: [] });
  useAgentPolicyStore.getState().propose(candidate({ kind: 'engineering', patch: {} }));
  assert.equal(useAgentPolicyStore.getState().apply('c1'), false); assert.equal(useAgentPolicyStore.getState().revision, 0);
});

test('reading policy revisions produce isolated response cache keys', async () => {
  const base = { action: 'explain' as const, model: { id: 'test', name: 'test', provider: 'openai-compatible' as const, baseUrl: 'https://example.com', apiKey: '', model: 'test', temperature: 0 },
    selection: { id: '1', selectedText: 'same selection', surroundingText: '', pageNumber: 1, timestamp: 1 } };
  assert.notEqual(await createAgentCacheKey({ ...base, skillContext: 'v1' }), await createAgentCacheKey({ ...base, skillContext: 'v2' }));
});
