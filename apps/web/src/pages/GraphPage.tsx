import { ArrowRight, GitBranch, Route, ShieldCheck } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader, ProgressBar, StatusPill } from "../components/ui";
import { useHelm } from "../state/helm-context";

export function GraphPage() {
  const { requirementId = "req-42" } = useParams();
  const navigate = useNavigate();
  const { snapshot } = useHelm();
  if (!snapshot) return null;

  const graph = snapshot.graphs.find((candidate) => candidate.requirementId === requirementId);
  const requirement = snapshot.requirements.find((candidate) => candidate.id === requirementId);
  if (!graph || !requirement) return <GraphNotFound />;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${requirement.key} · Work Graph v${graph.version}`}
        title={requirement.title}
        description={requirement.objective}
        action={
          <label className="select-field">
            <span>切换需求</span>
            <select value={requirementId} onChange={(event) => navigate(`/requirements/${event.target.value}/graph`)}>
              {snapshot.graphs.map((item) => {
                const target = snapshot.requirements.find((candidate) => candidate.id === item.requirementId);
                return target ? <option key={target.id} value={target.id}>{target.key} · {target.title}</option> : null;
              })}
            </select>
          </label>
        }
      />

      <section className="graph-summary reveal reveal--2" aria-label="工作图摘要">
        <div><GitBranch aria-hidden="true" size={18} /><span><strong>{graph.nodes.length}</strong> 个节点</span></div>
        <div><Route aria-hidden="true" size={18} /><span><strong>{graph.criticalPath.length}</strong> 个关键路径节点</span></div>
        <div><ShieldCheck aria-hidden="true" size={18} /><span>Graph version <strong>{graph.version}</strong></span></div>
        <div className="graph-progress"><ProgressBar value={requirement.progress} label="需求完成进度" /></div>
      </section>

      <section className="panel graph-panel reveal reveal--3" aria-labelledby="graph-title">
        <div className="panel-heading graph-panel-heading">
          <div><p className="eyebrow">Critical path</p><h2 id="graph-title">正常交付路径</h2></div>
          <ul className="graph-legend" aria-label="状态图例"><li><span className="legend-dot legend-dot--completed" />完成</li><li><span className="legend-dot legend-dot--active" />当前</li><li><span className="legend-dot" />未开始</li></ul>
        </div>

        <div className="graph-scroll" tabIndex={0} aria-label="工作图，可横向滚动">
          <ol className="work-graph">
            {graph.nodes.map((node, index) => (
              <li key={node.id} className={`graph-node-wrap ${index < graph.nodes.length - 1 ? "has-edge" : ""}`}>
                <Link to={`/work-items/${node.workItemId}`} className={`graph-node graph-node--${node.status} ${node.kind === "gate" ? "graph-node--gate" : ""}`}>
                  <div className="graph-node-top"><span className="node-number">0{index + 1}</span><StatusPill status={node.status} /></div>
                  <p className="eyebrow">{node.phase}</p>
                  <h3>{node.title}</h3>
                  <div className="graph-node-foot"><span>{node.kind === "gate" ? "Human Gate" : node.required ? "必需节点" : "非阻塞"}</span><ArrowRight aria-hidden="true" size={17} /></div>
                </Link>
              </li>
            ))}
          </ol>
        </div>

        <div className="graph-contract">
          <div><span>运行语义</span><strong>上游通过 → 下游自动就绪</strong></div>
          <div><span>状态来源</span><strong>事件投影，不可手工越级</strong></div>
          <div><span>当前版本</span><strong>所有执行绑定 v{graph.version}</strong></div>
        </div>
      </section>
    </div>
  );
}

function GraphNotFound() {
  return (
    <section className="empty-state"><GitBranch aria-hidden="true" size={28} /><h1>这项需求还没有工作图</h1><p>先为需求添加最小节点和依赖，再开始执行。</p><Link className="button button--primary" to="/projects">返回项目</Link></section>
  );
}

