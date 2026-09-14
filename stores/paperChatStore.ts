'use client';

import { create } from 'zustand';
import type { PaperChatMessage } from '@/types/chat';
import type { AgentRunReport, AgentTraceEvent } from '@/types/agentRuntime';

const welcomeMessage = (fileName?: string): PaperChatMessage => ({
  id: 'paper-assistant-welcome',
  role: 'assistant',
  content: fileName
    ? `你好，我是小研。我会优先阅读《${fileName}》后再回答，也可以帮你总结整篇论文。`
    : '你好，我是小研。打开一篇 PDF 后，我可以帮你总结论文并回答阅读问题。',
  createdAt: Date.now(),
});

interface PaperChatState {
  messages: PaperChatMessage[];
  isLoading: boolean;
  error: string | null;
  agentStatus: string | null;
  evidencePages: number[];
  activeResponseId: string | null;
  trace: AgentTraceEvent[];
  reset: (fileName?: string) => void;
  startRequest: (question: string, responseId: string) => void;
  appendResponse: (responseId: string, chunk: string) => void;
  setAgentStatus: (status: string, evidencePages?: number[]) => void;
  addTrace: (responseId: string, event: AgentTraceEvent) => void;
  finishAgent: (responseId: string, content: string, report: AgentRunReport) => void;
  completeRequest: (responseId: string) => void;
  failRequest: (responseId: string, message: string) => void;
}

export const usePaperChatStore = create<PaperChatState>((set) => ({
  messages: [welcomeMessage()],
  isLoading: false,
  error: null,
  agentStatus: null,
  evidencePages: [],
  activeResponseId: null,
  trace: [],
  reset: (fileName) => set({ messages: [welcomeMessage(fileName)], isLoading: false, error: null, agentStatus: null, evidencePages: [], activeResponseId: null, trace: [] }),
  startRequest: (question, responseId) => set((state) => ({
    messages: [
      ...state.messages,
      { id: crypto.randomUUID(), role: 'user', content: question, createdAt: Date.now() },
      { id: responseId, role: 'assistant', content: '', createdAt: Date.now() },
    ],
    isLoading: true,
    error: null,
    agentStatus: '正在分析问题…',
    evidencePages: [],
    activeResponseId: responseId,
    trace: [],
  })),
  addTrace: (responseId, event) => set((state) => state.activeResponseId === responseId ? { trace: [...state.trace, event], agentStatus: event.label } : state),
  finishAgent: (responseId, content, report) => set((state) => state.activeResponseId === responseId ? ({
    messages: state.messages.map((message) => message.id === responseId ? { ...message, content, report } : message),
    isLoading: false, agentStatus: null, activeResponseId: null,
  }) : state),
  setAgentStatus: (agentStatus, evidencePages = []) => set({ agentStatus, evidencePages }),
  appendResponse: (responseId, chunk) => set((state) => state.activeResponseId === responseId ? ({
    messages: state.messages.map((message) => message.id === responseId ? { ...message, content: message.content + chunk } : message),
  }) : state),
  completeRequest: (responseId) => set((state) => state.activeResponseId === responseId ? { isLoading: false, agentStatus: null, activeResponseId: null } : state),
  failRequest: (responseId, error) => set((state) => state.activeResponseId === responseId ? ({
    messages: state.messages.filter((message) => message.id !== responseId),
    isLoading: false,
    agentStatus: null,
    evidencePages: [],
    activeResponseId: null,
    error,
  }) : state),
}));
