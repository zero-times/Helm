import { ArrowUpRight, Layers3, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDate, Initials, PageHeader, ProgressBar, StatusPill } from "../components/ui";
import { useHelm } from "../state/helm-context";

export function ProjectsPage() {
  const { snapshot } = useHelm();
  if (!snapshot) return null;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Projects & requirements"
        title="从目标，看见真实进度。"
        description="需求状态由必需节点与 Gate 推导；不允许用一个手工状态掩盖未完成的工作。"
      />

      <section className="project-card-grid reveal reveal--2" aria-label="项目列表">
        {snapshot.projects.map((project) => (
          <article key={project.id} className="project-card">
            <div className="project-card-top">
              <span className="project-monogram">{project.key.slice(0, 1)}</span>
              {project.attentionCount > 0 ? <span className="attention-chip">{project.attentionCount} 项需关注</span> : <span className="quiet-chip">正常推进</span>}
            </div>
            <p className="eyebrow">{project.key} · {project.targetRelease}</p>
            <h2>{project.name}</h2>
            <p className="project-goal"><Target aria-hidden="true" size={16} />{project.goal}</p>
            <ProgressBar value={project.progress} label={`${project.name} 完成进度`} />
            <div className="project-card-meta">
              <span><strong>{project.activeRequirementCount}</strong> 活跃需求</span>
              <span><strong>{project.progress}%</strong> 必需节点完成</span>
            </div>
          </article>
        ))}
      </section>

      <section className="panel requirements-panel reveal reveal--3" aria-labelledby="requirements-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Requirement ledger</p>
            <h2 id="requirements-title">需求账本</h2>
          </div>
          <span className="subtle-stat"><Layers3 aria-hidden="true" size={16} />{snapshot.requirements.length} 项</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th scope="col">需求</th><th scope="col">状态</th><th scope="col">必需节点</th><th scope="col">责任人</th><th scope="col">更新</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {snapshot.requirements.map((requirement) => (
                <tr key={requirement.id}>
                  <td>
                    <span className="table-key">{requirement.key}</span>
                    <strong>{requirement.title}</strong>
                    <small>{requirement.objective}</small>
                  </td>
                  <td><StatusPill status={requirement.status} /></td>
                  <td>
                    <span className="fraction"><strong>{requirement.requiredCompleted}</strong> / {requirement.requiredTotal}</span>
                    <ProgressBar value={requirement.progress} label={`${requirement.title} 完成进度`} />
                  </td>
                  <td><span className="person-cell"><Initials initials={requirement.owner.initials} label={requirement.owner.name} />{requirement.owner.name}</span></td>
                  <td><time dateTime={requirement.updatedAt}>{formatDate(requirement.updatedAt)}</time></td>
                  <td>
                    {snapshot.graphs.some((graph) => graph.requirementId === requirement.id) ? (
                      <Link className="row-action" to={`/requirements/${requirement.id}/graph`} aria-label={`查看 ${requirement.title} 工作图`}><ArrowUpRight aria-hidden="true" size={18} /></Link>
                    ) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

