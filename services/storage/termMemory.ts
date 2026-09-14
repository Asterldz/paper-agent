const STORAGE_KEY = 'paper-agent:term-memory:v1';
const MAX_TERMS = 500;

export interface TermMemoryEntry {
  explanation: string;
  lastUsedAt: number;
  term: string;
  translation: string;
  uses: number;
}

function normalizeTerm(term: string) {
  return term.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function readTerms(): TermMemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as TermMemoryEntry[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.term && entry?.translation) : [];
  } catch {
    return [];
  }
}

function writeTerms(terms: TermMemoryEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(terms
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_TERMS)));
  } catch {
    // Translation continues normally when browser storage is unavailable.
  }
}

export function rememberTermsFromInsights(output: string): number {
  const pattern = /^[\u2022·-]\s*([^\n（(]{2,80})[\uff08(]([^\n）)]{1,60})[\uff09)]\s*[：:]\s*([^\n]{1,300})/gm;
  const parsed = Array.from(output.matchAll(pattern), (match) => ({
    term: match[1].trim(),
    translation: match[2].trim(),
    explanation: match[3].trim(),
  })).filter((entry) => /[A-Za-z]/.test(entry.term));
  if (!parsed.length) return 0;
  const terms = readTerms();
  const now = Date.now();
  for (const entry of parsed) {
    const normalized = normalizeTerm(entry.term);
    const existingIndex = terms.findIndex((term) => normalizeTerm(term.term) === normalized);
    const remembered: TermMemoryEntry = {
      ...entry,
      lastUsedAt: now,
      uses: existingIndex >= 0 ? terms[existingIndex].uses + 1 : 1,
    };
    if (existingIndex >= 0) terms.splice(existingIndex, 1, remembered);
    else terms.push(remembered);
  }
  writeTerms(terms);
  return parsed.length;
}

export function getExactRememberedTerm(text: string): TermMemoryEntry | null {
  const normalized = normalizeTerm(text.replace(/^[\s.,;:()[\]{}'"“”]+|[\s.,;:()[\]{}'"“”]+$/g, ''));
  const terms = readTerms();
  const match = terms.find((entry) => normalizeTerm(entry.term) === normalized) ?? null;
  if (match) {
    match.lastUsedAt = Date.now();
    match.uses += 1;
    writeTerms(terms);
  }
  return match;
}

export function findRememberedTerms(text: string, limit = 12): TermMemoryEntry[] {
  const normalizedText = ` ${text.toLocaleLowerCase()} `;
  const matches = readTerms()
    .filter((entry) => {
      const term = normalizeTerm(entry.term);
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(normalizedText);
    })
    .sort((a, b) => b.term.length - a.term.length)
    .slice(0, limit);
  if (matches.length) {
    const matched = new Set(matches.map((entry) => normalizeTerm(entry.term)));
    const now = Date.now();
    writeTerms(readTerms().map((entry) => matched.has(normalizeTerm(entry.term)) ? { ...entry, lastUsedAt: now, uses: entry.uses + 1 } : entry));
  }
  return matches;
}

export function clearTermMemory() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
}

export function getTermMemorySize() {
  return readTerms().length;
}
