import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { createLiteratureTools, type LiteratureEnvironment } from '../services/agent/literatureTools';
import { runLiteratureGraph, GRAPH_LIMITS, type GraphModelPorts } from '../services/agent/literatureGraph';
import { validateCitations } from '../services/agent/citationValidation';
import { DEFAULT_READING_POLICY } from '../services/agent/skillPolicy';
import type { LibraryDocument } from '../types/library';
import type { AgentTraceEvent } from '../types/agentRuntime';

const reference: LibraryDocument = { id: 'reference', title: 'Primary artifact removal experiment', name: 'Primary artifact removal experiment.pdf', size: 123,
  type: 'application/pdf', lastModified: 1, firstOpenedAt: 1, lastReadAt: 1, currentPage: 1, totalPages: 2, category: '未分类', tags: [], favorite: false, indexedAt: 1 };

function environment(overrides: Partial<LiteratureEnvironment> = {}): LiteratureEnvironment {
  return { documentId: 'current', title: 'Current paper',
    pages: [{ pageNumber: 1, text: 'The experiment measures EEG artifact removal accuracy. The primary method is described in reference [1].' },
      { pageNumber: 2, text: 'References\n[1] Primary artifact removal experiment. 2022. doi:10.1234/example.' }], selection: null,
    listDocuments: async () => [reference], loadPages: async () => [{ pageNumber: 1, text: 'Primary artifact removal experiment. DOI 10.1234/example. Accuracy was evaluated using independent recordings.' }],
    lookupTerms: () => [], signal: new AbortController().signal, ...overrides };
}

async function invokeTool(name: string, args: Record<string, unknown>, env = environment()) {
  const kit = createLiteratureTools(env);
  const target = kit.tools.find((item) => item.name === name)! as import('@langchain/core/tools').StructuredToolInterface;
  return { result: JSON.parse(await target.invoke(args)), sources: kit.sources };
}

test('tools read actual current-document evidence and validate arguments', async () => {
  const { result, sources } = await invokeTool('search_document', { query: 'EEG artifact removal' });
  assert.equal(result.status, 'ok'); assert.equal(sources[0].documentId, 'current'); assert.equal(sources[0].pageNumber, 1);
  await assert.rejects(() => invokeTool('read_page', { page: -1 }));
  await assert.rejects(() => invokeTool('read_page', { page: 1, command: 'delete' }));
});

test('arbitrary document IDs cannot be read', async () => {
  let reads = 0;
  await assert.rejects(() => invokeTool('search_document', { query: 'accuracy', documentId: '/secret' }, environment({ loadPages: async () => { reads++; return []; } })));
  assert.equal(reads, 0);
});

test('missing reference full text yields bibliography, not fabricated evidence', async () => {
  const { result, sources } = await invokeTool('read_reference', { number: 1, query: 'accuracy' }, environment({ listDocuments: async () => [] }));
  assert.equal(result.status, 'unavailable'); assert.equal(sources.length, 0); assert.ok(result.bibliography);
});

test('matched reference must also pass source identity check', async () => {
  const { result, sources } = await invokeTool('read_reference', { number: 1, query: 'accuracy' }, environment({ loadPages: async () => [{ pageNumber: 1, text: 'A different study with a similar file name; accuracy 99%.' }] }));
  assert.equal(result.status, 'unavailable'); assert.equal(sources.length, 0);
});

test('verified reference evidence keeps its document and citation number', async () => {
  const { result, sources } = await invokeTool('read_reference', { number: 1, query: 'accuracy' });
  assert.equal(result.status, 'ok'); assert.equal(sources[0].documentId, 'reference'); assert.equal(sources[0].referenceNumber, 1);
});

test('citation checking rejects invented source IDs and model-written page citations', () => {
  const source = { id: 'E1', documentId: 'current', title: 'Current', text: 'Evidence', pageNumber: 2 };
  const result = validateCitations('Claim [E1]. Claim [E999]. [当前论文，第 99 页]', [source]);
  assert.equal(result.rejected, 2); assert.deepEqual(result.sources, [source]); assert.ok(!result.content.includes('[E999]'));
});

async function run(model: GraphModelPorts, env = environment()) {
  const events: AgentTraceEvent[] = []; let output = '';
  const result = await runLiteratureGraph({ env, question: 'Explain EEG artifact removal and check reference 1', history: [], skill: 'Test reading skill',
    policy: DEFAULT_READING_POLICY, revision: 3, runId: 'test-run', model, onChunk: (chunk) => { output += chunk; }, onEvent: (event) => events.push(event) });
  return { ...result, events, output };
}

test('LangGraph performs model-selected tools and feeds observations into the next decision', async () => {
  let decisions = 0;
  const result = await run({ decide: async (messages) => {
    decisions++;
    if (decisions === 1) return new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'search_document', args: { query: 'EEG' } }] });
    assert.ok(messages.some((item) => item instanceof ToolMessage && String(item.content).includes('EEG')));
    if (decisions === 2) return new AIMessage({ content: '', tool_calls: [{ id: '2', name: 'read_reference', args: { number: 1, query: 'accuracy' } }] });
    return new AIMessage('Ready');
  }, answer: async function* () { yield 'A supported explanation '; yield '[E1]'; } });
  assert.equal(decisions, 3); assert.equal(result.report.toolCalls, 2); assert.equal(result.report.modelCalls, 4);
  assert.equal(result.report.policyRevision, 3); assert.equal(result.output, result.content);
  assert.ok(result.report.sources.some((item) => item.referenceNumber === 1));
  assert.deepEqual(result.events.map((event) => event.phase), ['plan', 'tool', 'plan', 'tool', 'plan', 'answer', 'verify']);
});

test('repeated identical calls terminate without another tool execution', async () => {
  const result = await run({ decide: async () => new AIMessage({ content: '', tool_calls: [{ id: 'repeat', name: 'search_document', args: { query: 'EEG' } }] }),
    answer: async function* () { yield 'Partial answer [E1]'; } });
  assert.equal(result.report.toolCalls, 1); assert.equal(result.report.stopReason, 'repeated-tool'); assert.equal(result.report.modelCalls, 3);
});

test('unknown tools are never executed, and planning cannot loop indefinitely', async () => {
  let sequence = 0;
  const result = await run({ decide: async () => new AIMessage({ content: '', tool_calls: [{ id: String(++sequence), name: 'run_shell', args: { command: 'erase' } }] }),
    answer: async function* () { yield 'The requested tool is unavailable.'; } });
  assert.equal(result.report.toolCalls, 0); assert.equal(result.report.modelCalls, GRAPH_LIMITS.planningRounds + 1);
  assert.ok(result.events.filter((event) => event.outcome === 'rejected').length > 0);
});

test('cancellation prevents the final answer node and subsequent UI chunks', async () => {
  const controller = new AbortController(); let answered = false;
  await assert.rejects(() => run({ decide: async () => { controller.abort(); return new AIMessage('Ready'); },
    answer: async function* () { answered = true; yield 'should not appear'; } }, environment({ signal: controller.signal })));
  assert.equal(answered, false);
});

test('no-tool conversation completes without forced research', async () => {
  const result = await run({ decide: async () => new AIMessage('General knowledge question'), answer: async function* () { yield 'General answer'; } });
  assert.equal(result.report.toolCalls, 0); assert.equal(result.report.stopReason, 'complete');
});
