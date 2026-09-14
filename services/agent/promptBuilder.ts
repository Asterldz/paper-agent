import { ASK_SYSTEM_PROMPT, EXPLAIN_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT, TERM_SYSTEM_PROMPT, TRANSLATION_SYSTEM_PROMPT } from './prompts';
import type { AgentAction, AgentContext } from '@/types/agent';
import type { Message } from '@/types/llm';
import { policyInstructions } from './skillPolicy';

const systemPrompts: Record<AgentAction, string> = {
  translate: TRANSLATION_SYSTEM_PROMPT,
  explain: EXPLAIN_SYSTEM_PROMPT,
  summarize: SUMMARY_SYSTEM_PROMPT,
  term: TERM_SYSTEM_PROMPT,
  ask: ASK_SYSTEM_PROMPT,
};

export function buildMessages(action: AgentAction, context: AgentContext): Message[] {
  const selectedText = context.selectedText?.trim() ?? '';
  const surroundingText = context.surroundingText?.trim() ?? '';
  const question = context.question?.trim();
  const terminology = context.terminologyHints?.map((hint) => `${hint.term} => ${hint.translation}`).join('\n') ?? '';
  const userContent = [
    surroundingText ? `<context>\n${surroundingText}\n</context>` : '',
    terminology ? `<terminology_memory>\n${terminology}\n</terminology_memory>` : '',
    `<selected_text>\n${selectedText}\n</selected_text>`,
    question ? `<question>\n${question}\n</question>` : '',
  ].filter(Boolean).join('\n\n');

  return [
    { role: 'system', content: systemPrompts[action] + (context.readingPolicy && action !== 'translate' ? `\n${policyInstructions(context.readingPolicy)}` : '') },
    ...(context.conversationHistory ?? []),
    { role: 'user', content: userContent },
  ];
}
