import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  CirclePlay,
  FileCheck2,
  GitCommitHorizontal,
  History,
  MessageSquareText,
  RotateCcw,
  Send,
  ShieldCheck,
  TestTube2,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatDate, Initials, StatusPill } from "../components/ui";
import type { ResultInput, ReviewInput, TimelineEvent, WorkItem } from "../domain";
import { useHelm } from "../state/helm-context";

export function WorkItemPage() {
  const { workItemId = "" } = useParams();
  const { snapshot, busyAction, beginExecution, submitResult, reviewResult, addComment } = useHelm();
  if (!snapshot) return null;

  const item = snapshot.workItems.find((candidate) => candidate.id === workItemId);
  if (!item) return <WorkItemNotFound />;
  const requirement = snapshot.requirements.find((candidate) => candidate.id === item.requirementId);

  return (
    <div className="page-stack work-item-page">
      <nav className="breadcrumbs" aria-label="面包屑">
        <Link to={`/requirements/${item.requirementId}/graph`}><ArrowLeft aria-hidden="true" size={16} />工作图</Link>
        <ChevronRight aria-hidden="true" size={14} />
        <span aria-current="page">{item.key}</span>
      </nav>

      <header className="work-header reveal">
        <div className="work-header-main">
          <div className="work-kicker"><span>{item.phase}</span><span>{requirement?.key}</span><span>实体 v{item.version}</span></div>
          <h1>{item.title}</h1>
          <p>{item.objective}</p>
        </div>
        <StatusPill status={item.status} />
      </header>

      <section className="responsibility-strip reveal reveal--2" aria-labelledby="responsibility-title">
        <div><p className="eyebrow" id="responsibility-title">Responsibility chain</p><strong>责任链</strong></div>
        <Responsibility label="最终责任" person={item.responsibilities.accountableHuman} />
        <Responsibility label="日常组织" person={item.responsibilities.operationalOwner} />
        <Responsibility label="当前执行" person={item.responsibilities.assignee} />
      </section>

      <div className="work-layout reveal reveal--3">
        <div className="work-primary">
          <section className="panel criteria-panel" aria-labelledby="criteria-title">
            <div className="panel-heading"><div><p className="eyebrow">Definition of done</p><h2 id="criteria-title">验收标准</h2></div><span className="count-badge">{item.acceptanceCriteria.length}</span></div>
            <ul className="criteria-list">
              {item.acceptanceCriteria.map((criterion) => <li key={criterion}><span><Check aria-hidden="true" size={15} /></span>{criterion}</li>)}
            </ul>
          </section>

          <Timeline events={item.timeline} />
          <CommentComposer item={item} busy={busyAction === `comment:${item.id}`} onSubmit={(body) => addComment(item.id, item.version, body)} />
        </div>

        <aside className="action-column" aria-label="任务操作">
          <ActionPanel
            item={item}
            busyAction={busyAction}
            onBegin={() => beginExecution(item.id, item.version)}
            onSubmitResult={(input) => submitResult(item.id, item.version, input)}
            onReview={(input) => reviewResult(item.id, item.version, input)}
          />
          <ExecutionHistory item={item} />
        </aside>
      </div>
    </div>
  );
}

function Responsibility({ label, person }: { label: string; person: { initials: string; name: string } }) {
  return <div className="responsibility"><Initials initials={person.initials} label={person.name} /><span><small>{label}</small><strong>{person.name}</strong></span></div>;
}

function ActionPanel({
  item,
  busyAction,
  onBegin,
  onSubmitResult,
  onReview,
}: {
  item: WorkItem;
  busyAction: string | null;
  onBegin(): Promise<boolean>;
  onSubmitResult(input: ResultInput): Promise<boolean>;
  onReview(input: ReviewInput): Promise<boolean>;
}) {
  if (item.status === "ready" || item.status === "rework") {
    const isRework = item.status === "rework";
    return (
      <section className="action-card action-card--ready">
        <span className="action-card-icon">{isRework ? <RotateCcw aria-hidden="true" /> : <CirclePlay aria-hidden="true" />}</span>
        <p className="eyebrow">Next action</p>
        <h2>{isRework ? "开始新的返工执行" : "可以开始执行"}</h2>
        <p>{isRework ? "历史 Result 保持不可变。系统将创建新的 Execution。" : "开始后将记录执行人、版本和时间。你可以随时回填结构化 Result。"}</p>
        <button className="button button--primary button--wide" type="button" disabled={busyAction === `begin:${item.id}`} onClick={() => void onBegin()}>
          <CirclePlay aria-hidden="true" size={18} />{busyAction === `begin:${item.id}` ? "正在开始…" : isRework ? "开始返工" : "开始人工执行"}
        </button>
        <small className="action-footnote">执行将绑定 Work Graph 当前版本</small>
      </section>
    );
  }

  if (item.status === "running") {
    return <ResultComposer item={item} busy={busyAction === `result:${item.id}`} onSubmit={onSubmitResult} />;
  }

  if (item.status === "waiting_review") {
    return <ReviewPanel item={item} busy={busyAction === `review:${item.id}`} onReview={onReview} />;
  }

  if (item.status === "completed") {
    return (
      <section className="action-card action-card--complete">
        <span className="action-card-icon"><ShieldCheck aria-hidden="true" /></span>
        <p className="eyebrow">Result accepted</p><h2>任务已通过</h2>
        <p>结构化结果与审核证据已固定，下游节点会依据工作图自动就绪。</p>
        <Link className="button button--secondary button--wide" to={`/requirements/${item.requirementId}/graph`}>查看工作图</Link>
      </section>
    );
  }

  return (
    <section className="action-card">
      <p className="eyebrow">Workflow state</p><h2>等待上游条件</h2><p>当前节点不能主动开始。满足硬依赖和 Gate 后，系统会自动将其转为就绪。</p>
    </section>
  );
}

function ResultComposer({ item, busy, onSubmit }: { item: WorkItem; busy: boolean; onSubmit(input: ResultInput): Promise<boolean> }) {
  const [summary, setSummary] = useState("");
  const [changedFiles, setChangedFiles] = useState("");
  const [artifactReference, setArtifactReference] = useState("");
  const [testSummary, setTestSummary] = useState("");
  const [knownIssues, setKnownIssues] = useState("");
  const [needsDecision, setNeedsDecision] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      summary: summary.trim(),
      changedFiles: splitLines(changedFiles),
      artifactReference: artifactReference.trim(),
      testSummary: testSummary.trim(),
      knownIssues: splitLines(knownIssues),
      needsHumanDecision: needsDecision,
    });
  }

  return (
    <section className="action-card result-composer">
      <p className="eyebrow">Execution #{item.executions.length}</p>
      <h2>回填结构化 Result</h2>
      <p>摘要是主信息；原始日志只作为必要时的审计证据。</p>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label className="field"><span>结果摘要 <em>必填</em></span><textarea required rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="完成了什么，行为有何变化？" /></label>
        <label className="field"><span>改动文件</span><textarea rows={3} value={changedFiles} onChange={(event) => setChangedFiles(event.target.value)} placeholder="每行一个文件路径" /></label>
        <label className="field"><span>Commit / Artifact</span><input value={artifactReference} onChange={(event) => setArtifactReference(event.target.value)} placeholder="例如 4ec6574 或制品地址" /></label>
        <label className="field"><span>测试结果</span><textarea rows={3} value={testSummary} onChange={(event) => setTestSummary(event.target.value)} placeholder="执行的命令、范围与结果" /></label>
        <label className="field"><span>已知问题</span><textarea rows={2} value={knownIssues} onChange={(event) => setKnownIssues(event.target.value)} placeholder="每行一项；没有可留空" /></label>
        <label className="check-field"><input type="checkbox" checked={needsDecision} onChange={(event) => setNeedsDecision(event.target.checked)} /><span>这个结果仍需要 Human 决策</span></label>
        <button className="button button--primary button--wide" type="submit" disabled={busy}><Send aria-hidden="true" size={17} />{busy ? "提交中…" : "提交审核"}</button>
      </form>
    </section>
  );
}

function ReviewPanel({ item, busy, onReview }: { item: WorkItem; busy: boolean; onReview(input: ReviewInput): Promise<boolean> }) {
  const [note, setNote] = useState("");
  const result = item.executions.at(-1)?.result;

  async function decide(decision: ReviewInput["decision"]) {
    await onReview({ decision, note: note.trim() || (decision === "approve" ? "验收标准已满足。" : "请按审核意见返工。") });
  }

  return (
    <section className="action-card review-card">
      <p className="eyebrow">Human review</p><h2>审核本次 Result</h2>
      {result ? (
        <div className="result-summary">
          <p>{result.summary}</p>
          <dl>
            <div><dt><GitCommitHorizontal aria-hidden="true" size={15} />改动</dt><dd>{result.changedFiles.length} 个文件</dd></div>
            <div><dt><TestTube2 aria-hidden="true" size={15} />测试</dt><dd>{result.tests.length ? "有证据" : "未提供"}</dd></div>
            <div><dt><Box aria-hidden="true" size={15} />制品</dt><dd>{result.artifacts.length}</dd></div>
          </dl>
          {result.knownIssues.length ? <div className="known-issues"><strong>已知问题</strong><ul>{result.knownIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
        </div>
      ) : null}
      <label className="field"><span>审核意见</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明通过依据，或明确返工要求" /></label>
      <div className="decision-buttons">
        <button className="button button--danger" type="button" disabled={busy} onClick={() => void decide("reject")}><RotateCcw aria-hidden="true" size={17} />退回返工</button>
        <button className="button button--primary" type="button" disabled={busy} onClick={() => void decide("approve")}><Check aria-hidden="true" size={17} />通过</button>
      </div>
      <small className="action-footnote">退回会创建新的执行路径，不覆盖当前 Result</small>
    </section>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading"><div><p className="eyebrow">Structured history</p><h2 id="timeline-title">Timeline</h2></div><History aria-hidden="true" size={20} /></div>
      {events.length ? (
        <ol className="timeline-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className={`timeline-icon timeline-icon--${event.type}`}>{timelineIcon(event.type)}</span>
              <article>
                <div className="timeline-title-row"><h3>{event.title}</h3><time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time></div>
                <p>{event.summary}</p>
                <div className="timeline-meta"><Initials initials={event.actor.initials} label={event.actor.name} /><span>{event.actor.name}</span><span>实体 v{event.entityVersion}</span></div>
                {event.rawLog ? <details className="raw-log"><summary>查看原始日志</summary><pre>{event.rawLog}</pre></details> : null}
              </article>
            </li>
          ))}
        </ol>
      ) : <p className="empty-copy">还没有结构化事件。</p>}
    </section>
  );
}

function CommentComposer({ item, busy, onSubmit }: { item: WorkItem; busy: boolean; onSubmit(body: string): Promise<boolean> }) {
  const [body, setBody] = useState("");
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onSubmit(body.trim())) setBody("");
  }
  return (
    <form className="comment-composer" onSubmit={(event) => void handleSubmit(event)}>
      <label htmlFor="timeline-comment"><MessageSquareText aria-hidden="true" size={17} />补充说明</label>
      <div><input id="timeline-comment" required value={body} onChange={(event) => setBody(event.target.value)} placeholder="添加上下文，不代替结构化 Result…" /><button type="submit" className="icon-button icon-button--solid" disabled={busy} aria-label="添加说明"><Send aria-hidden="true" size={17} /></button></div>
    </form>
  );
}

function ExecutionHistory({ item }: { item: WorkItem }) {
  return (
    <section className="execution-history" aria-labelledby="execution-title">
      <div className="mini-heading"><p className="eyebrow">Attempts</p><h2 id="execution-title">执行历史</h2></div>
      {item.executions.length ? (
        <ol>{[...item.executions].reverse().map((execution) => <li key={execution.id}><span>#{execution.attempt}</span><div><strong>{execution.mode === "self" ? "Human Self" : "外部手动"}</strong><small>{formatDate(execution.startedAt)}</small></div><StatusPill status={execution.status === "running" ? "running" : execution.result ? "completed" : "cancelled"} /></li>)}</ol>
      ) : <p>还没有执行记录。</p>}
    </section>
  );
}

function WorkItemNotFound() {
  return <section className="empty-state"><FileCheck2 aria-hidden="true" size={30} /><h1>没有找到这个任务</h1><p>它可能已被取消，或不属于当前工作区。</p><Link className="button button--primary" to="/requirements/req-42/graph">返回工作图</Link></section>;
}

function timelineIcon(type: TimelineEvent["type"]) {
  if (type === "result") return <FileCheck2 aria-hidden="true" size={16} />;
  if (type === "review" || type === "gate") return <ShieldCheck aria-hidden="true" size={16} />;
  if (type === "artifact") return <GitCommitHorizontal aria-hidden="true" size={16} />;
  if (type === "test") return <TestTube2 aria-hidden="true" size={16} />;
  if (type === "comment") return <MessageSquareText aria-hidden="true" size={16} />;
  return <History aria-hidden="true" size={16} />;
}

function splitLines(value: string): string[] {
  return value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
}

