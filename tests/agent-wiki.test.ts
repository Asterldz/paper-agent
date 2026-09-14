import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIMessage } from '@langchain/core/messages';
import { addWikiDraft, approveWikiDraft, createWikiDraft, EMPTY_WIKI, exportWikiMarkdown, rollbackWikiPage, searchWikiPages, wikiHealth } from '../services/agent/wikiKnowledge';
import { createLiteratureTools, type LiteratureEnvironment } from '../services/agent/literatureTools';
import { runLiteratureGraph } from '../services/agent/literatureGraph';
import { DEFAULT_READING_POLICY } from '../services/agent/skillPolicy';
import type { WikiProposal, WikiState } from '../types/wiki';
import type { EvidenceSource } from '../types/agentRuntime';

const source: EvidenceSource = { id: 'E1', documentId: 'paper-1', title: 'EEG study', pageNumber: 2,
  text: 'ICA separates multichannel EEG signals into independent components. The experiment used twenty subjects.' };
const source2: EvidenceSource = { id: 'E2', documentId: 'paper-2', title: 'CCA study', pageNumber: 1,
  text: 'CCA uses second-order statistics to separate signals in a different experimental setting.' };
const proposal: WikiProposal = { title: 'ICA 去伪迹', kind: 'concept', claims: [{ text: '该文献使用 ICA 分离多通道 EEG 信号。', type: 'source', sourceIds: ['E1'] }], relatedPageIds: [], reason: '整理 ICA 方法的原文依据' };
const empty = () => structuredClone(EMPTY_WIKI);
function initial() {
  const draft = createWikiDraft(empty(), proposal, [source], 'a', 1);
  return approveWikiDraft(addWikiDraft(empty(), draft), draft.id, 2);
}
const update = (state: WikiState, id: string, text = '该研究采用 ICA，并报告了独立成分的分离过程。') => createWikiDraft(state, { ...proposal, pageId: 'wiki-a', baseRevision: state.pages[0].revision, claims: [{ ...proposal.claims[0], text }] }, [source], id, 3);

test('Wiki draft creation does not publish and rejects sources not read in this run', () => {
  const draft = createWikiDraft(empty(), proposal, [source], 'a', 1);
  const state = addWikiDraft(empty(), draft);
  assert.equal(state.pages.length, 0); assert.equal(searchWikiPages(state.pages, 'ICA').length, 0);
  assert.throws(() => createWikiDraft(empty(), proposal, [], 'b', 1), /本次任务/);
  assert.throws(() => createWikiDraft(empty(), { ...proposal, command: 'approve' } as WikiProposal, [source], 'b', 1));
});

test('adoption publishes sources and cannot be repeated', () => {
  const state = initial();
  assert.equal(state.pages[0].revision, 1); assert.equal(state.pages[0].sources[0].text, source.text);
  assert.equal(state.drafts[0].status, 'applied');
  assert.throws(() => approveWikiDraft(state, 'a', 4));
});

test('draft updates require the revision actually read, not the newest implicit revision', () => {
  const state = initial();
  assert.throws(() => createWikiDraft(state, { ...proposal, pageId: 'wiki-a' }, [source], 'b', 3), /baseRevision/);
  assert.throws(() => createWikiDraft(state, { ...proposal, baseRevision: 0 }, [source], 'b', 3), /baseRevision/);
  assert.throws(() => createWikiDraft(state, { ...proposal, pageId: 'missing', baseRevision: 1 }, [source], 'b', 3));
});

test('two competing updates cannot overwrite each other', () => {
  let state = initial();
  state = addWikiDraft(addWikiDraft(state, update(state, 'b')), update(state, 'c', '第二份草稿说明 ICA 分解的不同方面。'));
  state = approveWikiDraft(state, 'b', 5);
  assert.throws(() => approveWikiDraft(state, 'c', 6), /过期/);
  assert.equal(state.pages[0].revision, 2);
});

test('same-title new drafts cannot create duplicate published pages', () => {
  let state = addWikiDraft(empty(), createWikiDraft(empty(), proposal, [source], 'a', 1));
  state = addWikiDraft(state, createWikiDraft(state, proposal, [source], 'b', 1));
  state = approveWikiDraft(state, 'a', 2);
  assert.throws(() => approveWikiDraft(state, 'b', 3), /同名/);
});

test('rollback restores original content, increases revision and invalidates old drafts', () => {
  let state = initial();
  state = approveWikiDraft(addWikiDraft(state, update(state, 'b')), 'b', 4);
  state = addWikiDraft(state, update(state, 'c'));
  state = rollbackWikiPage(state, 'wiki-a', 2, 1, 5);
  assert.equal(state.pages[0].revision, 3); assert.equal(state.pages[0].claims[0].text, proposal.claims[0].text);
  assert.throws(() => approveWikiDraft(state, 'c', 6), /过期/);
  assert.throws(() => rollbackWikiPage(state, 'wiki-a', 2, 1, 6), /版本已变化/);
});

test('cross-paper comparison preserves separate sources, relations and inference labels', () => {
  let state = initial();
  const comparison = createWikiDraft(state, { title: 'ICA 与 CCA 比较', kind: 'comparison', reason: '比较不同研究条件', relatedPageIds: ['wiki-a'],
    claims: [{ text: '两项实验设置不同，不能直接比较性能数字。', type: 'inference', sourceIds: ['E1', 'E2'] }] }, [source, source2], 'b', 3);
  state = approveWikiDraft(addWikiDraft(state, comparison), 'b', 4);
  assert.equal(state.pages[0].sources.length, 2); assert.equal(state.pages[0].claims[0].type, 'inference');
  assert.deepEqual(state.pages[0].relatedPageIds, ['wiki-a']);
  assert.ok(searchWikiPages(state.pages, '实验设置').some((page) => page.id === 'wiki-b'));
  assert.match(exportWikiMarkdown(state.pages), /AI 推断/); assert.match(exportWikiMarkdown(state.pages), /#wiki-a/);
});

test('health check surfaces missing raw documents, abstract-only access, and unresolved conflict', () => {
  const state = initial();
  const page = { ...state.pages[0], claims: [{ ...proposal.claims[0], type: 'conflict' as const }], sources: [{ ...source, sourceKind: 'abstract' as const }] };
  const issues = wikiHealth([page], new Set());
  assert.equal(issues.length, 3);
});

function environment(state: WikiState, overrides: Partial<LiteratureEnvironment> = {}): LiteratureEnvironment {
  return { documentId: source.documentId, title: source.title, pages: [{ pageNumber: 2, text: source.text }], selection: null,
    listDocuments: async () => [], loadPages: async () => [], lookupTerms: () => [], signal: new AbortController().signal,
    wiki: { search: async (query) => searchWikiPages(state.pages, query), read: async (id) => state.pages.find((page) => page.id === id),
      propose: async (input, sources) => createWikiDraft(state, input, sources, 'new', 10) }, ...overrides };
}

test('Wiki search is a navigation hint, not a new primary evidence source', async () => {
  const kit = createLiteratureTools(environment(initial()));
  const result = JSON.parse(await kit.tools.find((tool) => tool.name === 'search_wiki')!.invoke({ query: 'ICA' }));
  assert.equal(result.pages.length, 1); assert.equal(kit.sources.length, 0);
});

test('Wiki read rechecks raw text and remaps citations, without retaining another paper reference number', async () => {
  const state = initial(); state.pages[0].sources[0].referenceNumber = 9;
  const kit = createLiteratureTools(environment(state, { selection: { selectedText: 'A separate selection', pageNumber: 1 } as LiteratureEnvironment['selection'] }));
  const result = JSON.parse(await kit.tools.find((tool) => tool.name === 'read_wiki_page')!.invoke({ pageId: 'wiki-a' }));
  assert.equal(result.claims[0].allSourcesVerified, true);
  assert.deepEqual(result.claims[0].verifiedSourceIds, ['E2']);
  assert.equal(kit.sources[1].referenceNumber, undefined);
});

test('changed or missing raw evidence cannot be reused as a verified citation', async () => {
  const kit = createLiteratureTools(environment(initial(), { pages: [{ pageNumber: 2, text: 'A completely different version of the paper.' }] }));
  const result = JSON.parse(await kit.tools.find((tool) => tool.name === 'read_wiki_page')!.invoke({ pageId: 'wiki-a' }));
  assert.equal(result.evidence.length, 0); assert.equal(result.claims[0].allSourcesVerified, false); assert.ok(result.warnings.length);
  assert.equal(kit.sources.length, 0);
});

test('LangGraph creates a review draft from actual retrieved evidence, then reads it after adoption', async () => {
  let state = empty(); let round = 0;
  const env = environment(state);
  env.wiki = { search: async (query) => searchWikiPages(state.pages, query), read: async (id) => state.pages.find((page) => page.id === id),
    propose: async (input, evidence) => { const draft = createWikiDraft(state, input, evidence, 'draft', 1); state = addWikiDraft(state, draft); return draft; } };
  const result = await runLiteratureGraph({ env, question: '把 ICA 整理到知识库', history: [], skill: '', policy: DEFAULT_READING_POLICY, revision: 0, runId: 'wiki-run',
    model: { decide: async () => {
      const calls = [ { name: 'search_document', args: { query: 'ICA' } }, { name: 'propose_wiki_update', args: proposal } ];
      const call = calls[round++];
      return call ? new AIMessage({ content: '', tool_calls: [{ ...call, id: String(round) }] }) : new AIMessage('Ready');
    }, answer: async function* () { yield '已生成待审核草稿，请到知识库核对。'; } }, onChunk: () => {}, onEvent: () => {} });
  assert.equal(result.report.toolCalls, 2); assert.equal(state.pages.length, 0); assert.equal(state.drafts.length, 1);
  state = approveWikiDraft(state, 'draft', 2);
  const kit = createLiteratureTools(env);
  const read = JSON.parse(await kit.tools.find((tool) => tool.name === 'read_wiki_page')!.invoke({ pageId: 'wiki-draft' }));
  assert.equal(read.evidence[0].text, source.text); assert.equal(read.claims[0].allSourcesVerified, true);
});

test('cancelled Wiki reads produce no source evidence', async () => {
  const controller = new AbortController(); const env = environment(initial(), { signal: controller.signal });
  env.wiki!.read = async () => { controller.abort(); return initial().pages[0]; };
  const kit = createLiteratureTools(env);
  await assert.rejects(() => kit.tools.find((tool) => tool.name === 'read_wiki_page')!.invoke({ pageId: 'wiki-a' }));
  assert.equal(kit.sources.length, 0);
});
