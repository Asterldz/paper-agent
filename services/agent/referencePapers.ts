import type { LibraryDocument, ReferenceEntry, ResolvedReference } from '@/types/library';
import type { DocumentPageText } from '@/types/pdf';
import type { PaperEvidence } from './paperRetrieval';

export interface ReferencePaperContext {
  reference: ResolvedReference;
  document: LibraryDocument | null;
  evidence: PaperEvidence[];
}

const REFERENCE_HEADING = /^\s*(references|bibliography|works cited|参考文献)\s*[:：]?\s*$/im;
const NUMBERED_ENTRY = /(?:^|\n)\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+/gm;
const DOI_PATTERN = /\b10\.\d{4,9}\/[\w.()/:;-]+/i;
const YEAR_PATTERN = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/;
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

const MATCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'using', 'based', 'study', 'analysis', 'method', 'methods', 'paper', 'journal', 'proceedings',
  'vol', 'volume', 'issue', 'pages', 'page', 'doi', 'et', 'al', 'of', 'in', 'on', 'to', 'a', 'an', 'is', 'are',
]);

export function parseReferenceEntries(pages: DocumentPageText[]): ReferenceEntry[] {
  if (!pages.length) return [];
  const searchStart = Math.max(0, Math.floor(pages.length * 0.5));
  let headingPageIndex = -1;
  let headingOffset = -1;

  for (let index = searchStart; index < pages.length; index += 1) {
    const match = REFERENCE_HEADING.exec(pages[index].text);
    REFERENCE_HEADING.lastIndex = 0;
    if (match) {
      headingPageIndex = index;
      headingOffset = (match.index ?? 0) + match[0].length;
      break;
    }
  }
  if (headingPageIndex < 0) return [];

  const sourceParts = pages.slice(headingPageIndex).map((page, index) => {
    const text = index === 0 ? page.text.slice(headingOffset) : page.text;
    return `\n<page:${page.pageNumber}>\n${text.replace(/\r/g, '')}`;
  });
  const source = sourceParts.join('\n');
  const matches = Array.from(source.matchAll(NUMBERED_ENTRY));
  if (!matches.length) return [];

  return matches.slice(0, 300).flatMap((match, index) => {
    const number = Number(match[1] ?? match[2]);
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const rawWithMarkers = source.slice(start, end);
    const pageMarkers = Array.from(rawWithMarkers.matchAll(/<page:(\d+)>/g));
    const previousMarker = source.slice(0, start).match(/<page:(\d+)>[^<]*$/);
    const bibliographyPage = Number(previousMarker?.[1] ?? pageMarkers[0]?.[1] ?? pages[headingPageIndex].pageNumber);
    const raw = cleanReferenceText(rawWithMarkers.replace(/<page:\d+>/g, ' '));
    if (!Number.isFinite(number) || raw.length < 12) return [];
    const doi = raw.match(DOI_PATTERN)?.[0]?.replace(/[.,;]+$/, '');
    const yearMatch = raw.match(YEAR_PATTERN);
    return [{
      id: `ref-${number}`,
      number,
      raw,
      title: inferReferenceTitle(raw),
      year: yearMatch ? Number(yearMatch[1]) : undefined,
      doi,
      bibliographyPage,
    } satisfies ReferenceEntry];
  }).filter((entry, index, entries) => entries.findIndex((item) => item.number === entry.number) === index);
}

export function resolveReferences(
  references: ReferenceEntry[],
  documents: LibraryDocument[],
  currentDocumentId: string,
): ResolvedReference[] {
  return references.map((reference) => {
    const scored = documents
      .filter((document) => document.id !== currentDocumentId)
      .map((document) => ({ document, score: referenceDocumentScore(reference, document) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    return {
      ...reference,
      matchedDocumentId: best && best.score >= 0.46 ? best.document.id : null,
      matchConfidence: best?.score ?? 0,
    };
  });
}

export function extractCitationNumbers(value: string): number[] {
  const numbers = new Set<number>();
  for (const match of value.matchAll(/\[(\d{1,3}(?:\s*[-,，–—]\s*\d{1,3})*)\]/g)) {
    for (const part of match[1].split(/\s*[,，]\s*/)) {
      const range = part.split(/\s*[-–—]\s*/).map(Number);
      if (range.length === 2 && range.every(Number.isFinite) && range[1] >= range[0] && range[1] - range[0] <= 20) {
        for (let value = range[0]; value <= range[1]; value += 1) numbers.add(value);
      } else if (Number.isFinite(range[0])) numbers.add(range[0]);
    }
  }
  return Array.from(numbers).slice(0, 12);
}

export function rankReferencesForQuestion(references: ResolvedReference[], question: string, limit = 5): ResolvedReference[] {
  const query = new Set(tokens(question));
  return references.map((reference) => {
    const entryTokens = tokens(`${reference.title ?? ''} ${reference.raw}`);
    const overlap = entryTokens.filter((token) => query.has(token)).length;
    return { reference, score: overlap / Math.max(3, Math.sqrt(entryTokens.length * Math.max(1, query.size))) };
  }).sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, limit)
    .map((item) => item.reference);
}

export function buildReferenceContext(contexts: ReferencePaperContext[]): string {
  if (!contexts.length) return '<reference_papers>\n没有触发需要核查的参考论文。\n</reference_papers>';
  return `<reference_papers>\n${contexts.map((context) => {
    const metadata = `<reference number="${context.reference.number}" full_text="${context.evidence.length ? 'available' : 'unavailable'}">\n${context.reference.raw}`;
    if (!context.evidence.length) return `${metadata}\n说明：只有当前论文中的书目信息，未读取该参考论文全文。\n</reference>`;
    const evidence = context.evidence.map((item, index) => (
      `<reference_evidence id="R${context.reference.number}-E${index + 1}" page="${item.pageNumber}">\n${item.text}\n</reference_evidence>`
    )).join('\n');
    return `${metadata}\n本地全文：${context.document?.title ?? context.document?.name ?? '已匹配文献'}\n${evidence}\n</reference>`;
  }).join('\n\n')}\n</reference_papers>`;
}

function referenceDocumentScore(reference: ReferenceEntry, document: LibraryDocument): number {
  const referenceTokens = new Set(tokens(reference.title || reference.raw));
  const documentTokens = new Set(tokens(`${document.title} ${document.name}`));
  if (!referenceTokens.size || !documentTokens.size) return 0;
  let shared = 0;
  for (const token of documentTokens) if (referenceTokens.has(token)) shared += 1;
  const coverage = shared / documentTokens.size;
  const similarity = shared / Math.max(referenceTokens.size, documentTokens.size);
  const normalizedReference = normalize(reference.title || reference.raw);
  const normalizedDocument = normalize(document.title || document.name.replace(/\.pdf$/i, ''));
  const containsBonus = normalizedDocument.length >= 12 && normalizedReference.includes(normalizedDocument) ? 0.45 : 0;
  const yearBonus = reference.year && document.name.includes(String(reference.year)) ? 0.08 : 0;
  return Math.min(1, coverage * 0.58 + similarity * 0.34 + containsBonus + yearBonus);
}

function inferReferenceTitle(raw: string): string | undefined {
  const quoted = raw.match(/[“\"]([^”\"]{12,240})[”\"]/);
  if (quoted) return quoted[1].trim();
  const segments = raw.split(/\.\s+/).map((part) => part.trim()).filter(Boolean);
  const yearIndex = segments.findIndex((part) => YEAR_PATTERN.test(part));
  const nearby = yearIndex >= 0 ? segments.slice(Math.max(0, yearIndex - 4), yearIndex + 3) : segments.slice(0, 7);
  const candidates = nearby.map((part) => {
    const cleaned = part.replace(/^.*?(?:19|20)\d{2}[a-z]?[),;:]?\s*/i, '').replace(/\s+/g, ' ').trim();
    const words = cleaned.match(/[\p{L}\p{N}]+/gu) ?? [];
    let score = Math.min(cleaned.length, 120) + words.length * 5;
    if (cleaned.length < 14 || cleaned.length > 240 || words.length < 3) score -= 300;
    if (/^(https?|doi\b)/i.test(cleaned) || /\b(vol(?:ume)?|issue|pp?|pages?|journal|proceedings|conference)\b/i.test(cleaned)) score -= 90;
    if ((cleaned.match(/\b[A-Z]\./g) ?? []).length >= 3 || (cleaned.match(/,/g) ?? []).length >= 4) score -= 100;
    return { cleaned, score };
  }).sort((a, b) => b.score - a.score);
  return candidates[0]?.score > 0 ? candidates[0].cleaned : undefined;
}

function cleanReferenceText(value: string): string {
  return value.replace(/-\s*\n\s*/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value: string): string {
  return tokens(value).join(' ');
}

function tokens(value: string): string[] {
  return (value.toLocaleLowerCase().match(TOKEN_PATTERN) ?? [])
    .filter((token) => token.length > 1 && !MATCH_STOP_WORDS.has(token));
}
