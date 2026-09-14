export interface ReadingPolicy {
  answerStyle: 'concise' | 'structured';
  referenceDepth: 'when-needed' | 'prefer-primary';
  termDetail: 'brief' | 'extended';
}

export interface EvidenceSource {
  id: string;
  documentId: string;
  title: string;
  pageNumber: number;
  referenceNumber?: number;
  url?: string;
  sourceKind?: 'full-text' | 'abstract';
  locator?: string;
  text: string;
}

export interface AgentTraceEvent {
  id: string;
  phase: 'plan' | 'tool' | 'answer' | 'verify' | 'stop';
  label: string;
  tool?: string;
  elapsedMs: number;
  outcome?: 'ok' | 'unavailable' | 'rejected';
}

export interface AgentRunReport {
  runId: string;
  framework: 'LangGraph';
  skillVersion: string;
  policyRevision: number;
  modelCalls: number;
  toolCalls: number;
  elapsedMs: number;
  firstTokenMs: number | null;
  sources: EvidenceSource[];
  trace: AgentTraceEvent[];
  warnings: string[];
  stopReason: 'complete' | 'budget' | 'repeated-tool';
}

export interface SkillCandidate {
  id: string;
  parentRevision: number;
  feedback: string;
  runId?: string;
  createdAt: number;
  kind: 'preference' | 'strategy' | 'engineering' | 'unclear';
  patch: Partial<ReadingPolicy>;
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
}
