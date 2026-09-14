import type { DocumentPageText, TextSelection } from '@/types/pdf';

export interface PaperEvidence {
  pageNumber: number;
  text: string;
  score: number;
}

export interface PaperAgentPreparation {
  evidence: PaperEvidence[];
  evidencePages: number[];
  intent: 'summary' | 'compare' | 'lookup';
  searchTerms: string[];
  trace: string[];
}

interface PaperChunk extends PaperEvidence {
  tokens: string[];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were', 'be', 'this', 'that', 'what', 'why', 'how',
  '请', '这篇', '论文', '文章', '什么', '哪些', '如何', '为什么', '进行', '一个', '以及', '可以', '作者', '研究',
]);

const SUMMARY_TERMS = /总结|概括|摘要|主要内容|核心贡献|整篇|summary|overview/i;
const COMPARE_TERMS = /比较|区别|差异|优缺点|相较|versus|\bvs\.?\b|compare|difference/i;

export function preparePaperAgent(pages: DocumentPageText[], question: string, selection: TextSelection | null): PaperAgentPreparation {
  const intent = SUMMARY_TERMS.test(question) ? 'summary' : COMPARE_TERMS.test(question) ? 'compare' : 'lookup';
  const searchTerms = tokenize(question).slice(0, 14);
  const chunks = createChunks(pages);
  const evidence = intent === 'summary'
    ? summaryEvidence(chunks, pages.length)
    : rankedEvidence(chunks, searchTerms, intent === 'compare' ? 9 : 7);

  if (selection?.selectedText.trim()) {
    evidence.unshift({ pageNumber: selection.pageNumber, text: selection.selectedText.trim().slice(0, 1600), score: Number.POSITIVE_INFINITY });
  }
  const uniqueEvidence = deduplicateEvidence(evidence).slice(0, 10);
  const evidencePages = Array.from(new Set(uniqueEvidence.map((item) => item.pageNumber))).sort((a, b) => a - b);
  const trace = [
    intent === 'summary' ? '规划：抽取研究目标、方法、结果与局限' : intent === 'compare' ? '规划：分别检索比较对象与共同评价维度' : '规划：定位问题中的核心概念',
    searchTerms.length ? `检索：${searchTerms.slice(0, 6).join('、')}` : '检索：扫描论文结构与关键页面',
    evidencePages.length ? `证据：第 ${evidencePages.join('、')} 页` : '证据：没有找到高相关片段',
    '校验：要求结论绑定真实页码',
  ];
  return { evidence: uniqueEvidence, evidencePages, intent, searchTerms, trace };
}

export function buildEvidenceContext(preparation: PaperAgentPreparation): string {
  return preparation.evidence.map((item, index) => (
    `<evidence id="E${index + 1}" page="${item.pageNumber}">\n${item.text}\n</evidence>`
  )).join('\n\n');
}

function createChunks(pages: DocumentPageText[]): PaperChunk[] {
  return pages.flatMap((page) => {
    const paragraphs = page.text
      .replace(/\r/g, '')
      .split(/\n{1,}/)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter((part) => part.length >= 24);
    const groups: string[] = [];
    let current = '';
    for (const paragraph of paragraphs) {
      if (!current || current.length + paragraph.length + 1 <= 850) current = current ? `${current} ${paragraph}` : paragraph;
      else { groups.push(current); current = paragraph; }
    }
    if (current) groups.push(current);
    return groups.map((text) => ({ pageNumber: page.pageNumber, text, score: 0, tokens: tokenize(text) }));
  });
}

function rankedEvidence(chunks: PaperChunk[], queryTokens: string[], limit: number): PaperEvidence[] {
  if (!chunks.length) return [];
  if (!queryTokens.length) return chunks.slice(0, limit);
  const documentFrequency = new Map<string, number>();
  for (const chunk of chunks) {
    for (const token of new Set(chunk.tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  return chunks.map((chunk) => {
    const counts = new Map<string, number>();
    for (const token of chunk.tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    let score = 0;
    for (const token of queryTokens) {
      const frequency = counts.get(token) ?? 0;
      if (!frequency) continue;
      const inverseFrequency = Math.log(1 + chunks.length / (1 + (documentFrequency.get(token) ?? 0)));
      score += inverseFrequency * (frequency / (frequency + 1.2));
    }
    const normalizedText = chunk.text.toLocaleLowerCase();
    const phrase = queryTokens.filter((token) => token.length >= 4).join(' ');
    if (phrase && normalizedText.includes(phrase)) score += 2.5;
    return { pageNumber: chunk.pageNumber, text: chunk.text, score };
  }).filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((chunk, index, values) => values.slice(0, index).filter((item) => item.pageNumber === chunk.pageNumber).length < 2)
    .slice(0, limit);
}

function summaryEvidence(chunks: PaperChunk[], totalPages: number): PaperEvidence[] {
  const sectionTerms = ['abstract', 'introduction', 'method', 'methodology', 'experiment', 'results', 'discussion', 'conclusion', 'limitation'];
  const sectionChunks = rankedEvidence(chunks, sectionTerms, 8);
  const representativePages = new Set([1, 2, Math.max(1, Math.ceil(totalPages / 2)), Math.max(1, totalPages - 1), totalPages]);
  const representatives = chunks.filter((chunk) => representativePages.has(chunk.pageNumber)).slice(0, 7);
  return deduplicateEvidence([...sectionChunks, ...representatives]).slice(0, 10);
}

function deduplicateEvidence(evidence: PaperEvidence[]): PaperEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const signature = `${item.pageNumber}:${item.text.slice(0, 120).toLocaleLowerCase()}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function tokenize(value: string): string[] {
  const normalized = value.toLocaleLowerCase().normalize('NFKC');
  const latin = normalized.match(/[a-z][a-z0-9_-]{1,}/g) ?? [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  const chinese = chineseRuns.flatMap((run) => {
    const tokens = [run];
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
    return tokens;
  });
  return [...latin, ...chinese].filter((token) => !STOP_WORDS.has(token));
}
