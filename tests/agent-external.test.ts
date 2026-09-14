import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAcademic, normalizeExternalId, parsePmcFullText, readExternalPaper, searchExternalPapers } from '../services/agent/externalPaperServer';
import { createLiteratureTools, type LiteratureEnvironment } from '../services/agent/literatureTools';
import type { ExternalPaper, ExternalPaperRead } from '../types/externalPaper';

const signal = () => new AbortController().signal;
const paper: ExternalPaper = { id: 'PMC1234', pmcid: 'PMC1234', title: 'A controlled experiment in EEG artifact removal', doi: '10.1234/example', year: 2022, provider: 'Europe PMC', url: 'https://europepmc.org/articles/PMC1234' };
const paragraph = 'The EEG artifact removal experiment compared independent recordings using a held-out test set. The method improved signal quality under the tested conditions.';
const xml = `<article><front><article-id pub-id-type="pmc">1234</article-id></front><body><sec><title>Results</title><p>${paragraph}</p></sec></body><back><ref>Not body evidence</ref></back></article>`;
const record = { id: '123', source: 'MED', pmcid: 'PMC1234', doi: paper.doi, title: paper.title, pubYear: '2022', abstractText: 'An EEG artifact removal study with independent recordings.' };
const mock: typeof fetch = async (url) => {
  const value = String(url);
  if (value.includes('fullTextXML')) return new Response(xml);
  if (value.includes('europepmc')) return Response.json({ resultList: { result: [record] } });
  return Response.json({ message: { DOI: paper.doi, title: [paper.title], published: { 'date-parts': [[2022]] } } });
};

test('external identifiers reject URLs and normalize DOI/PMCID/arXiv', () => {
  assert.equal(normalizeExternalId('https://doi.org/10.1234/EXAMPLE'), 'doi:10.1234/example');
  assert.equal(normalizeExternalId('https://arxiv.org/pdf/1706.03762.pdf'), 'arxiv:1706.03762');
  assert.equal(normalizeExternalId('10.48550/arXiv.1706.03762'), 'arxiv:1706.03762');
  for (const id of ['http://localhost/admin', 'https://127.0.0.1/', 'file:///secret', 'PMC1234/../../secret']) assert.equal(normalizeExternalId(id), null);
});

test('academic fetch blocks redirect to internal or arbitrary hosts before issuing request', async () => {
  let count = 0;
  await assert.rejects(() => fetchAcademic('https://www.ebi.ac.uk/test', signal(), async () => { count++; return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } }); }));
  assert.equal(count, 1);
  await assert.rejects(() => fetchAcademic('https://example.com/', signal(), async () => { count++; return new Response('bad'); }));
  assert.equal(count, 1);
});

test('bounded streaming rejects oversized external responses without content-length', async () => {
  await assert.rejects(() => fetchAcademic('https://www.ebi.ac.uk/test', signal(), async () => new Response('123456789'), 5), /大小上限/);
});

test('DOI search merges duplicate metadata and reads actual open body paragraphs', async () => {
  const search = await searchExternalPapers('10.1234/example', signal(), mock);
  assert.equal(search.papers.length, 1);
  const read = await readExternalPaper('doi:10.1234/example', signal(), mock) as ExternalPaperRead;
  assert.equal(read.kind, 'full-text'); assert.equal(read.pageKind, 'section');
  assert.ok(read.pages.some((item) => item.text === paragraph));
  assert.ok(!read.pages.some((item) => item.text.includes('Not body evidence')));
});

test('PMCID lookup uses the provider PMCID field', async () => {
  let url = '';
  await searchExternalPapers('PMC1234', signal(), async (input) => { url = String(input); return mock(input); });
  assert.equal(new URL(url).searchParams.get('query'), 'PMCID:PMC1234');
});

test('full-text failure falls back to explicitly labeled abstract only', async () => {
  const read = await readExternalPaper('PMC1234', signal(), async (input) => String(input).includes('fullTextXML') ? new Response('', { status: 403 }) : mock(input)) as ExternalPaperRead;
  assert.equal(read.kind, 'abstract'); assert.match(read.note, /HTTP 403/); assert.match(read.note, /仅取得摘要/);
});

test('wrong full-text identity is rejected', () => {
  assert.throws(() => parsePmcFullText(xml.replace('>1234<', '>5678<'), paper), /编号不匹配/);
  assert.equal(parsePmcFullText(xml.replace('pub-id-type="pmc">1234', 'pub-id-type="pmcid">PMC1234'), paper).kind, 'full-text');
});

test('one failed search provider preserves the other result and reports failure', async () => {
  const result = await searchExternalPapers('EEG artifacts', signal(), async (input) => String(input).includes('crossref') ? new Response('', { status: 429 }) : mock(input));
  assert.equal(result.papers.length, 1); assert.match(result.warnings[0], /429/);
});

function env(read = parsePmcFullText(xml, paper)): LiteratureEnvironment {
  return { documentId: 'current', title: 'Current', pages: [{ pageNumber: 1, text: 'References\n[1] A controlled experiment in EEG artifact removal. 2022. DOI 10.1234/example.' }], selection: null,
    listDocuments: async () => [], loadPages: async () => [], lookupTerms: () => [], signal: signal(),
    external: { search: async () => ({ papers: [paper], warnings: [] }), read: async () => read } };
}

test('missing local reference automatically retrieves external evidence and retains reference identity', async () => {
  const kit = createLiteratureTools(env());
  const tool = kit.tools.find((item) => item.name === 'read_reference')!;
  const result = JSON.parse(await tool.invoke({ number: 1, query: 'EEG artifact' }));
  assert.equal(result.status, 'ok'); assert.equal(result.access, 'full-text');
  assert.equal(kit.sources[0].referenceNumber, 1); assert.equal(kit.sources[0].url, paper.url);
  assert.match(kit.sources[0].locator!, /在线全文/);
});

test('abstract evidence is labeled, metadata-only yields no sources, wrong DOI is rejected', async () => {
  const abstract = { paper, kind: 'abstract' as const, pages: [{ pageNumber: 1, text: paragraph }], pageKind: 'section' as const, note: 'Only abstract' };
  const kit = createLiteratureTools(env(abstract));
  await kit.tools.find((item) => item.name === 'read_external_paper')!.invoke({ id: 'PMC1234', query: 'EEG' });
  assert.equal(kit.sources[0].sourceKind, 'abstract'); assert.equal(kit.sources[0].locator, '摘要');
  const metadata = createLiteratureTools(env({ ...abstract, kind: 'metadata', pages: [] }));
  await metadata.tools.find((item) => item.name === 'read_external_paper')!.invoke({ id: 'PMC1234', query: 'EEG' });
  assert.equal(metadata.sources.length, 0);
  const wrong = createLiteratureTools(env({ ...abstract, paper: { ...paper, doi: '10.1234/wrong' } }));
  const result = JSON.parse(await wrong.tools.find((item) => item.name === 'read_reference')!.invoke({ number: 1, query: 'EEG' }));
  assert.equal(result.status, 'unavailable'); assert.equal(wrong.sources.length, 0);
});

test('cancelled external retrieval never adds source evidence', async () => {
  const controller = new AbortController(); const environment = env(); environment.signal = controller.signal;
  environment.external!.read = async () => { controller.abort(); return parsePmcFullText(xml, paper); };
  const kit = createLiteratureTools(environment);
  await assert.rejects(() => kit.tools.find((item) => item.name === 'read_external_paper')!.invoke({ id: 'PMC1234', query: 'EEG' }));
  assert.equal(kit.sources.length, 0);
});
