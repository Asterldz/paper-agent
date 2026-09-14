'use client';

import { useEffect, useRef, useState } from 'react';
import { useAgentPolicyStore, withPolicyLock } from '@/stores/agentPolicyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { canAutoApply } from '@/services/agent/evolutionRules';
import type { AgentRunReport, EvidenceSource } from '@/types/agentRuntime';

export function AgentRunDetails({ report, onSource }: { report: AgentRunReport; onSource: (source: EvidenceSource) => void }) {
  const exportReport = () => {
    // Export metadata, not API credentials, questions, or full paper passages.
    const { sources, ...metadata } = report;
    const data = { ...metadata, sources: sources.map(({ id, title, pageNumber, referenceNumber, url, sourceKind, locator }) => ({ id, title, pageNumber, referenceNumber, url, sourceKind, locator })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `paper-agent-run-${report.runId}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <details className="mt-3 border-t border-[#e1e3e7] pt-2 text-xs leading-5 text-[#747b86]">
    <summary className="cursor-pointer">执行记录 · {report.toolCalls} 次工具 · {(report.elapsedMs / 1000).toFixed(1)} 秒</summary>
    <p>LangGraph · {report.skillVersion} · 阅读策略 v{report.policyRevision} · 模型请求 {report.modelCalls} 次</p>
    <ol className="my-2 space-y-1">{report.trace.map((item) => <li key={item.id}>{item.label}{item.outcome === 'unavailable' ? '（未取得全文/匹配）' : item.outcome === 'rejected' ? '（已阻止）' : ''}</li>)}</ol>
    {report.warnings.map((warning) => <p className="text-amber-800" key={warning}>{warning}</p>)}
    {report.sources.length ? <details className="mt-2"><summary className="cursor-pointer">查看已读取原文（{report.sources.length} 条）</summary>{report.sources.map((source) => <div className="mt-2 border-l-2 border-[#d8dce2] pl-2" key={source.id}><button className="text-left underline" onClick={() => onSource(source)} type="button">[{source.id}] {source.title} · {source.locator ?? `PDF 第 ${source.pageNumber} 页`}</button><p className="mt-1 whitespace-pre-wrap">{source.text}</p></div>)}</details> : null}
    <button className="mt-2 underline" onClick={exportReport} type="button">导出运行指标（不含正文）</button>
  </details>;
}

export function AgentEvolutionPanel({ runId }: { runId?: string }) {
  const state = useAgentPolicyStore();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async () => {
    if (busy || !feedback.trim()) return;
    const settings = useSettingsStore.getState();
    const model = settings.models.find((item) => item.id === settings.activeModelId);
    if (!model) { setMessage('请先配置模型。'); return; }
    setBusy(true); setMessage('正在分类反馈并检查允许的修改范围…');
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 35_000);
    try {
      const [{ proposeSkillEvolution }, { EVOLUTION_SKILL }] = await Promise.all([import('@/services/agent/evolutionGraph'), import('@/services/agent/skills')]);
      await useAgentPolicyStore.persist.rehydrate();
      const snapshot = useAgentPolicyStore.getState();
      const recent = snapshot.candidates[0];
      if (recent && Date.now() - recent.createdAt < 10_000) { setMessage('请稍候再提交下一条反馈，避免重复调用。'); return; }
      const candidate = await proposeSkillEvolution({ feedback: feedback.trim().slice(0, 1000), revision: snapshot.revision,
        policy: { ...snapshot.policy }, runId, skill: EVOLUTION_SKILL, model, signal: abort.signal });
      abort.signal.throwIfAborted();
      await withPolicyLock(() => {
        const current = useAgentPolicyStore.getState();
        current.propose(candidate);
        const auto = current.autoPreferences && Boolean(navigator.locks) && canAutoApply(candidate, current.revision);
        if (auto && useAgentPolicyStore.getState().apply(candidate.id)) setMessage('明确偏好已通过范围检查并自动生效；可撤销。');
        else setMessage(candidate.kind === 'engineering' || candidate.kind === 'unclear' ? candidate.reason : '候选已生成。请检查差异后采用；尚未证明回答质量提升。');
      });
      setFeedback('');
    } catch { setMessage('反馈处理未完成，当前阅读策略没有改变。请稍后重试。'); }
    finally { window.clearTimeout(timeout); setBusy(false); }
  };
  return <details className="border-t border-[#e1e3e7] bg-white px-4 py-3 text-sm leading-6">
    <summary className="cursor-pointer text-[#626975]">阅读策略与反馈 · v{state.revision}</summary>
    <p className="mt-2 text-xs text-[#858b95]">反馈会调整当前设备的阅读方式；普通聊天不会自动修改 Skill。策略候选须审核，工程故障只记录，不改提示词。</p>
    <p className="mt-2 text-xs">{state.policy.answerStyle === 'structured' ? '条理化解释' : '简洁回答'} · {state.policy.referenceDepth === 'prefer-primary' ? '重视参考原文' : '按需追踪参考'} · {state.policy.termDetail === 'brief' ? '简短术语' : '扩展术语'}</p>
    <label className="my-2 flex items-center gap-2 text-xs"><input checked={state.autoPreferences} onChange={(event) => { const value = event.target.checked; void withPolicyLock(() => useAgentPolicyStore.getState().setAutoPreferences(value)); }} type="checkbox" />自动采用明确的长期表达偏好（仅简洁/分段，不改权限）</label>
    <textarea aria-label="阅读反馈" className="settings-input mt-1 min-h-16 w-full text-sm" maxLength={1000} onChange={(event) => setFeedback(event.target.value)} placeholder="例如：以后回答简短一点。或：希望更重视参考原文。" value={feedback} />
    <div className="mt-2 flex gap-3"><button className="toolbar-button" disabled={busy || !feedback.trim()} onClick={() => void submit()} type="button">{busy ? '处理中…' : '提交反馈'}</button><button className="toolbar-button" disabled={!state.history.length || busy} onClick={() => void withPolicyLock(() => useAgentPolicyStore.getState().rollback())} type="button">恢复上一策略</button></div>
    <p className="mt-1 text-xs text-[#858b95]">明确格式偏好本地处理；其他反馈最多发起 1 次模型请求（上限 800 输出 Token），不后台循环调用。</p>
    {message ? <p aria-live="polite" className="mt-2 text-xs">{message}</p> : null}
    {state.candidates.slice(0, 4).map((item) => <div className="mt-3 rounded border border-[#e1e3e7] p-2 text-xs" key={item.id}>
      <p>{item.reason}</p><p className="text-[#858b95]">{Object.keys(item.patch).length ? JSON.stringify(item.patch) : '无策略修改'} · {item.status === 'applied' ? '已采用' : item.status === 'rejected' ? '已拒绝' : '待处理'}</p>
      {item.status === 'pending' ? <div className="mt-1 flex gap-3"><button disabled={!Object.keys(item.patch).length || item.parentRevision !== state.revision} onClick={() => void withPolicyLock(() => { if (!useAgentPolicyStore.getState().apply(item.id)) setMessage('候选已过期或不符合范围检查，请基于当前版本重新提交。'); })} type="button">采用此候选</button><button onClick={() => void withPolicyLock(() => useAgentPolicyStore.getState().reject(item.id))} type="button">拒绝</button></div> : null}
    </div>)}
  </details>;
}
