import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createGraphModel } from '../services/agent/langchainModel';
import type { ModelConfig } from '../types/settings';

const config: ModelConfig = { id: 'test', name: 'test', provider: 'openai-compatible', apiKey: 'test-only', baseUrl: 'https://example.test/v1/chat/completions', model: 'deepseek-chat', temperature: 0, maxTokens: 2048 };
const tools = [tool(({ query }) => query, { name: 'search_document', description: 'Search paper', schema: z.object({ query: z.string() }) })];

test('LangChain adapter sends actual tool schemas and preserves tool-call IDs on follow-up', async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, body: JSON.parse(await request.text()) });
    return Response.json({ id: 'test', object: 'chat.completion', created: 1, model: 'deepseek-chat',
      choices: [{ index: 0, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop', message: requests.length === 1
        ? { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_document', arguments: '{"query":"EEG"}' } }] }
        : { role: 'assistant', content: 'Ready' } }] });
  };
  try {
    const model = createGraphModel(config);
    const response = await model.decide([new HumanMessage('Explain EEG')], tools, new AbortController().signal);
    assert.equal(response.tool_calls?.[0].name, 'search_document'); assert.equal(response.tool_calls?.[0].id, 'call_1');
    await model.decide([new HumanMessage('Explain EEG'), response, new ToolMessage({ tool_call_id: 'call_1', content: 'Evidence' })], tools, new AbortController().signal);
    assert.equal(requests[0].url, 'https://example.test/v1/chat/completions');
    assert.equal((requests[0].body.tools as unknown[]).length, 1);
    assert.deepEqual(requests[0].body.thinking, { type: 'disabled' });
    assert.equal(requests[0].body.max_tokens, 1536);
    assert.ok(JSON.stringify(requests[1].body.messages).includes('call_1'));
  } finally { globalThis.fetch = original; }
});

test('answer path reads streamed visible content and makes only one bounded request', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)).thinking, { type: 'disabled' });
    return new Response('data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    let result = '';
    for await (const text of createGraphModel(config).answer([new HumanMessage('hello')], new AbortController().signal)) result += text;
    assert.equal(result, '回答'); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('Wiki drafting receives enough output budget for structured tool arguments', async () => {
  const original = globalThis.fetch; let maxTokens = 0;
  globalThis.fetch = async (input, init) => {
    maxTokens = JSON.parse(await new Request(input, init).text()).max_tokens;
    return Response.json({ id: 'wiki', object: 'chat.completion', created: 1, model: 'deepseek-chat', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Ready' } }] });
  };
  try {
    const draft = tool(({ text }) => text, { name: 'propose_wiki_update', description: 'Propose review draft', schema: z.object({ text: z.string() }) });
    await createGraphModel(config).decide([new HumanMessage('Save a wiki draft')], [draft], new AbortController().signal);
    assert.equal(maxTokens, 4096);
  } finally { globalThis.fetch = original; }
});

test('unsupported tool API fails visibly and is not silently treated as a successful Agent run', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { message: 'tools unsupported', type: 'invalid_request_error' } }, { status: 400 }); };
  try {
    await assert.rejects(() => createGraphModel(config).decide([new HumanMessage('question')], tools, new AbortController().signal));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
