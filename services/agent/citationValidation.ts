import type { EvidenceSource } from '@/types/agentRuntime';

export function validateCitations(text: string, sources: EvidenceSource[]) {
  const used = new Set<string>();
  let rejected = 0;
  // The model cannot create clickable page citations directly.
  let content = text.replace(/\[(?:当前论文[，,]\s*)?第\s*\d+\s*页\]|\[参考文献\s*\d+[，,]\s*第\s*\d+\s*页\]/g, () => {
    rejected += 1; return '〔未经来源定位核验〕';
  });
  content = content.replace(/\[E(\d+)\]/g, (match) => {
    const source = sources.find((item) => `[${item.id}]` === match);
    if (!source) { rejected += 1; return '〔来源不可验证〕'; }
    used.add(source.id);
    return match;
  });
  return { content, sources: sources.filter((item) => used.has(item.id)), rejected };
}
