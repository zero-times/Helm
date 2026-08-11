import { ArrowUpRight, CheckCircle2, Compass, GitBranch, Plus, ShieldCheck, Sparkles, TimerReset } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDate, PageHeader, ProgressBar } from "../components/ui";
import { useHelm } from "../state/helm-context";

export function CockpitPage() {
  const { snapshot } = useHelm();
  if (!snapshot) return null;

  const activeRequirements = snapshot.requirements.filter((item) => item.status !== "completed").length;
  const runningItems = snapshot.workItems.filter((item) => item.status === "running").length;
  const nextRelease = snapshot.releases[0];

  return (
    <div className="page-stack cockpit-page">
      <PageHeader
        eyebrow="Tuesday · 11 August"
        title={snapshot.attention.length ? `今天，只需要处理 ${snapshot.attention.length} 件事。` : "今天没有待决事项。"}
        description="Helm 已把执行噪声压缩成可行动的决策。其余工作按 Work Graph 正常推进。"
        action={
          <div className="page-header-actions">
            <Link className="cta-button" to="/requirements/new">
              <Plus aria-hidden="true" size={16} />
              新建需求
            </Link>
            <div className="day-stamp" aria-label="2026年8月11日">
              <span>11</span>
              <small>AUG</small>
            </div>
          </div>
        }
      />

      <section className="metric-grid reveal reveal--2" aria-label="工作区摘要">
        <article className="metric-card metric-card--ink">
          <span className="metric-icon"><Sparkles aria-hidden="true" size={18} /></span>
          <p>需要你决定</p>
          <strong>{snapshot.attention.length}</strong>
          <small>按风险和阻塞影响排序</small>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><GitBranch aria-hidden="true" size={18} /></span>
          <p>活跃需求</p>
          <strong>{activeRequirements}</strong>
          <small>{snapshot.graphs.length} 张工作图正在推进</small>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><TimerReset aria-hidden="true" size={18} /></span>
          <p>执行中</p>
          <strong>{runningItems}</strong>
          <small>{runningItems === 0 ? "没有失联或超时执行" : "均在预期时间内"}</small>
        </article>
        <article className="metric-card">
          <span className="metric-icon"><ShieldCheck aria-hidden="true" size={18} /></span>
          <p>下一版本</p>
          <strong className="metric-release">{nextRelease?.name ?? "—"}</strong>
          <small>{nextRelease ? formatDate(nextRelease.targetAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "尚未安排"}</small>
        </article>
      </section>

      <div className="cockpit-grid reveal reveal--3">
        <section className="panel attention-panel" aria-labelledby="attention-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Attention queue</p>
              <h2 id="attention-title">待你处理</h2>
            </div>
            <span className="count-badge">{snapshot.attention.length}</span>
          </div>
          {snapshot.attention.length === 0 ? (
            <div className="empty-next-card">
              <Compass aria-hidden="true" size={28} />
              <h2>没有需要你关注的事项</h2>
              <p>当前工作区没有阻塞或等待决策的条目。你可以创建新的需求，或浏览需求账本查看整体进度。</p>
              <div className="empty-next-actions">
                <Link className="cta-button" to="/requirements/new"><Plus aria-hidden="true" size={16} />新建需求</Link>
                <Link className="cta-button cta-button--outline" to="/projects">查看需求账本<ArrowUpRight aria-hidden="true" size={15} /></Link>
              </div>
            </div>
          ) : (
            <div className="attention-list">
              {snapshot.attention.map((item, index) => (
                <article key={item.id} className={`attention-item attention-item--${item.severity}`}>
                  <span className="attention-index">0{index + 1}</span>
                  <div>
                    <p className="attention-kicker">
                      {item.severity === "decision" ? "需要授权" : item.severity === "blocked" ? "流程阻塞" : "可以行动"}
                    </p>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    <Link to={item.href} className="text-link">
                      {item.targetLabel}<ArrowUpRight aria-hidden="true" size={16} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="panel pulse-panel" aria-labelledby="pulse-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">System pulse</p>
              <h2 id="pulse-title">最近发生</h2>
            </div>
            <span className="live-mark"><span /> LIVE</span>
          </div>
          <ol className="event-list">
            {snapshot.recentEvents.slice(0, 4).map((event) => (
              <li key={event.id}>
                <span className="event-dot"><CheckCircle2 aria-hidden="true" size={14} /></span>
                <div>
                  <h3>{event.title}</h3>
                  <p>{event.summary}</p>
                  <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <section className="panel project-pulse reveal reveal--4" aria-labelledby="projects-pulse-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Portfolio</p>
            <h2 id="projects-pulse-title">项目脉搏</h2>
          </div>
          <Link to="/projects" className="text-link">查看全部<ArrowUpRight aria-hidden="true" size={16} /></Link>
        </div>
        <div className="project-pulse-grid">
          {snapshot.projects.map((project) => (
            <article key={project.id}>
              <div className="project-lockup">
                <span>{project.key.slice(0, 1)}</span>
                <div><h3>{project.name}</h3><p>{project.goal}</p></div>
              </div>
              <ProgressBar value={project.progress} label={`${project.name} 完成进度`} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
