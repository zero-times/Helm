import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, FileClock, PackageCheck, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { formatDate, Initials, PageHeader, StatusPill } from "../components/ui";
import type { Release } from "../domain";
import { useHelm } from "../state/helm-context";

export function ReleasePage() {
  const { snapshot, busyAction, approveRelease } = useHelm();
  if (!snapshot) return null;

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Release center" title="发布是一次明确授权。" description="变更范围、测试证据、未关闭风险和回滚计划被压缩成可审阅的发布包。" />
      <div className="release-list reveal reveal--2">
        {snapshot.releases.map((release) => (
          <ReleaseCard
            key={release.id}
            release={release}
            busy={busyAction === `release:${release.id}`}
            requirements={snapshot.requirements.filter((item) => release.requirementIds.includes(item.id))}
            onApprove={(note) => approveRelease(release.id, { note })}
          />
        ))}
      </div>
    </div>
  );
}

function ReleaseCard({
  release,
  requirements,
  busy,
  onApprove,
}: {
  release: Release;
  requirements: { id: string; key: string; title: string; status: "draft" | "in_progress" | "blocked" | "waiting_review" | "ready_for_release" | "completed" }[];
  busy: boolean;
  onApprove(note: string): Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const blocked = release.checks.some((check) => check.status === "blocked");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onApprove(note.trim());
  }

  return (
    <article className="release-card" data-release-id={release.id}>
      <header className="release-head">
        <div className="release-title-lockup"><span><PackageCheck aria-hidden="true" size={24} /></span><div><p className="eyebrow">Next release</p><h2>{release.name}</h2></div></div>
        <div className="release-head-meta"><StatusPill status={release.status} /><time dateTime={release.targetAt}><FileClock aria-hidden="true" size={15} />目标 {formatDate(release.targetAt)}</time></div>
      </header>

      <div className="release-grid">
        <div className="release-package">
          <section aria-labelledby={`${release.id}-checks`}>
            <div className="mini-heading"><p className="eyebrow">Gate checks</p><h3 id={`${release.id}-checks`}>发布检查</h3></div>
            <ul className="release-checks">
              {release.checks.map((check) => (
                <li key={check.id} className={`release-check release-check--${check.status}`}>
                  <span>{check.status === "passed" ? <Check aria-hidden="true" size={15} /> : <AlertTriangle aria-hidden="true" size={15} />}</span>
                  <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                </li>
              ))}
            </ul>
          </section>

          <section className="release-requirements" aria-labelledby={`${release.id}-requirements`}>
            <div className="mini-heading"><p className="eyebrow">Included scope</p><h3 id={`${release.id}-requirements`}>包含需求</h3></div>
            <ul>{requirements.map((requirement) => <li key={requirement.id}><div><span>{requirement.key}</span><strong>{requirement.title}</strong></div><StatusPill status={requirement.status} /></li>)}</ul>
          </section>

          <section className="rollback-plan" aria-labelledby={`${release.id}-rollback`}>
            <p className="eyebrow">Rollback plan</p><h3 id={`${release.id}-rollback`}>回滚方案</h3><p>{release.rollbackPlan}</p>
          </section>
        </div>

        <aside className={`release-gate ${release.status === "approved" ? "release-gate--approved" : ""}`}>
          {release.status === "approved" ? (
            <div className="approval-complete"><span><CheckCircle2 aria-hidden="true" size={30} /></span><p className="eyebrow">Authorized</p><h3>发布已获授权</h3><p>{release.approver.name} 已确认发布包与回滚责任。</p><div className="approval-actor"><Initials initials={release.approver.initials} label={release.approver.name} /><span><strong>{release.approver.name}</strong><small>{release.approvedAt ? formatDate(release.approvedAt) : "刚刚"}</small></span></div></div>
          ) : (
            <form onSubmit={(event) => void handleSubmit(event)}>
              <span className="gate-icon"><ShieldCheck aria-hidden="true" size={25} /></span>
              <p className="eyebrow">Human gate</p><h3>授权这个版本发布</h3>
              <p>授权代表你已审阅范围、证据、风险和回滚方案，并承担本次发布责任。</p>
              <div className="approver-row"><Initials initials={release.approver.initials} label={release.approver.name} /><span><small>授权人</small><strong>{release.approver.name}</strong></span></div>
              <label className="field"><span>授权说明 <em>必填</em></span><textarea required rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录授权依据和接受的风险" /></label>
              {blocked ? <p className="gate-blocked" role="alert"><AlertTriangle aria-hidden="true" size={16} />存在阻塞检查，当前不能授权。</p> : null}
              <button className="button button--primary button--wide" type="submit" disabled={busy || blocked}><ShieldCheck aria-hidden="true" size={17} />{busy ? "正在授权…" : "明确授权发布"}</button>
              <small className="action-footnote">该操作会写入不可变审计事件</small>
            </form>
          )}
        </aside>
      </div>
      <footer className="release-foot"><Link className="text-link" to="/projects">查看需求账本<ArrowUpRight aria-hidden="true" size={16} /></Link><span>发布包生成于 {formatDate(new Date().toISOString())}</span></footer>
    </article>
  );
}
