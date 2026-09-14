export interface PaperChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  report?: import('./agentRuntime').AgentRunReport;
}
