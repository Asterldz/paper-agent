import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { explicitFeedback, guardEvolutionProposal } from './evolutionRules';
import type { SkillCandidate, ReadingPolicy } from '@/types/agentRuntime';
import type { ModelConfig } from '@/types/settings';

export async function proposeSkillEvolution(options: {
  feedback: string; revision: number; policy: ReadingPolicy; runId?: string;
  skill: string; model: ModelConfig; signal: AbortSignal;
}): Promise<SkillCandidate> {
  const State = Annotation.Root({ proposal: Annotation<ReturnType<typeof guardEvolutionProposal>>() });
  const graph = new StateGraph(State)
    .addNode('classify', async () => {
      options.signal.throwIfAborted();
      const local = explicitFeedback(options.feedback);
      if (local) return { proposal: local };
      const config = options.model;
      const model = new ChatOpenAI({ apiKey: config.apiKey.trim() || 'local-no-key', model: config.model,
        maxTokens: 800, temperature: 0, maxRetries: 0, timeout: 30_000, useResponsesApi: false,
        ...(/deepseek/i.test(`${config.model} ${config.baseUrl}`) ? { modelKwargs: { thinking: { type: 'disabled' } } } : {}),
        configuration: { baseURL: config.baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, ''), dangerouslyAllowBrowser: true } });
      const result = await model.invoke([
        new SystemMessage(`${options.skill}\n当前运行模式：仅生成待审核候选。不改变任何源文件。只返回 JSON，形如 {"kind":"strategy","patch":{"answerStyle":"concise"},"reason":"原因"}。最多改变一个槽位：answerStyle=concise|structured，referenceDepth=when-needed|prefer-primary，termDetail=brief|extended。不明确或工程错误返回 kind=unclear|engineering、patch={}。不可修改权限、预算、API、评测。用户偏好以外的推测不得自动生效。`),
        new HumanMessage(JSON.stringify({ feedback: options.feedback, policy: options.policy })),
      ], { signal: options.signal });
      const content = typeof result.content === 'string' ? result.content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim() : '';
      try { return { proposal: guardEvolutionProposal(JSON.parse(content)) }; }
      catch { return { proposal: guardEvolutionProposal(null) }; }
    })
    .addNode('guard', (state) => {
      options.signal.throwIfAborted();
      const local = explicitFeedback(options.feedback);
      return { proposal: local ?? guardEvolutionProposal(state.proposal) };
    })
    .addEdge(START, 'classify').addEdge('classify', 'guard').addEdge('guard', END).compile();
  const result = await graph.invoke({}, { signal: options.signal, recursionLimit: 4 });
  return { id: crypto.randomUUID(), parentRevision: options.revision, feedback: options.feedback.slice(0, 1000),
    runId: options.runId, createdAt: Date.now(), ...result.proposal, status: 'pending' };
}
