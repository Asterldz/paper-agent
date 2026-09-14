import { z } from 'zod';
import type { EvidenceSource } from './agentRuntime';

export const wikiProposalSchema = z.object({
  pageId: z.string().max(100).optional(),
  baseRevision: z.number().int().min(0).optional(),
  title: z.string().trim().min(2).max(120),
  kind: z.enum(['paper', 'concept', 'comparison']),
  claims: z.array(z.object({
    text: z.string().trim().min(8).max(1200),
    type: z.enum(['source', 'inference', 'conflict']),
    sourceIds: z.array(z.string().regex(/^E\d+$/)).min(1).max(6),
  }).strict()).min(1).max(10),
  relatedPageIds: z.array(z.string().max(100)).max(8),
  reason: z.string().trim().min(4).max(500),
}).strict();

export type WikiProposal = z.infer<typeof wikiProposalSchema>;
export interface WikiContent {
  title: string;
  kind: WikiProposal['kind'];
  claims: WikiProposal['claims'];
  sources: EvidenceSource[];
  relatedPageIds: string[];
}
export interface WikiRevision extends WikiContent { revision: number; createdAt: number; reason: string }
export interface WikiPage extends WikiRevision { id: string; history: WikiRevision[] }
export interface WikiDraft extends WikiContent {
  id: string;
  pageId: string;
  baseRevision: number;
  createdAt: number;
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
}
export interface WikiState { version: 1; pages: WikiPage[]; drafts: WikiDraft[] }
export interface WikiPort {
  search: (query: string) => Promise<WikiPage[]>;
  read: (id: string) => Promise<WikiPage | undefined>;
  propose: (input: WikiProposal, sources: EvidenceSource[], signal: AbortSignal) => Promise<WikiDraft>;
}
