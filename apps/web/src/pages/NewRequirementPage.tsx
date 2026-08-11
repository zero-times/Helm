import {
  ArrowLeft,
  ChevronRight,
  GripVertical,
  MinusCircle,
  Plus,
  PlusCircle,
  Send,
  Target,
  Users,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useHelm } from "../state/helm-context";
import type { CreateWorkGraphEdgeInput, CreateWorkGraphNodeInput, Requirement } from "../domain";

interface WorkItemDraft {
  key: string;
  title: string;
  isRequired: boolean;
}

export function NewRequirementPage() {
  const { snapshot, busyAction, createRequirement, createWorkGraph, setSelectedMemberId } = useHelm();
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState("");
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [accountableId, setAccountableId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [workItems, setWorkItems] = useState<WorkItemDraft[]>([
    { key: "item-1", title: "", isRequired: true },
  ]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [createdRequirement, setCreatedRequirement] = useState<Requirement | null>(null);

  if (!snapshot) return null;

  const members = snapshot.members;
  const unnamedWarning = members.some((member) => member.name.endsWith("（待实名）"));
  const isBusy = busyAction === "create-requirement" || busyAction === "create-graph";

  function addCriterion() {
    setCriteria([...criteria, ""]);
  }

  function removeCriterion(index: number) {
    if (criteria.length <= 1) return;
    setCriteria(criteria.filter((_, i) => i !== index));
  }

  function updateCriterion(index: number, value: string) {
    const next = [...criteria];
    next[index] = value;
    setCriteria(next);
  }

  function addWorkItem() {
    if (workItems.length >= 5) return;
    setWorkItems([
      ...workItems,
      { key: `item-${workItems.length + 1}`, title: "", isRequired: false },
    ]);
  }

  function removeWorkItem(index: number) {
    if (workItems.length <= 1) return;
    setWorkItems(workItems.filter((_, i) => i !== index));
  }

  function updateWorkItem(index: number, field: keyof WorkItemDraft, value: string | boolean) {
    const next = [...workItems];
    next[index] = { ...next[index], [field]: value };
    setWorkItems(next);
  }

  function validate(): boolean {
    const errors: string[] = [];
    if (!projectId) errors.push("请选择所属项目。");
    if (!goal.trim()) errors.push("请填写需求目标。");
    const filledCriteria = criteria.filter((c) => c.trim());
    if (!filledCriteria.length) errors.push("请至少填写一条验收标准。");
    if (!accountableId) errors.push("请指定最终责任人。");
    if (!ownerId) errors.push("请指定日常负责人。");
    if (!assigneeId) errors.push("请指定当前执行人。");
    const titledItems = workItems.filter((w) => w.title.trim());
    if (!titledItems.length) errors.push("请至少为第一个工作项填写标题。");
    setValidationErrors(errors);
    return errors.length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;

    const filledCriteria = criteria.filter((c) => c.trim());
    const titledItems = workItems.filter((w) => w.title.trim());

    const requirement = createdRequirement ?? await createRequirement({
        projectId,
        goal: goal.trim(),
        acceptanceCriteria: filledCriteria,
        accountableHumanId: accountableId,
        operationalOwnerId: ownerId,
        assigneeMemberId: assigneeId,
      });

    if (!requirement) return;
    setCreatedRequirement(requirement);

    const nodes: CreateWorkGraphNodeInput[] = titledItems.map((item, index) => ({
      key: `item-${index + 1}`,
      title: item.title.trim(),
      isRequired: item.isRequired,
    }));

    const edges: CreateWorkGraphEdgeInput[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        sourceKey: nodes[i].key,
        targetKey: nodes[i + 1].key,
        isHardDependency: true,
      });
    }

    const graph = await createWorkGraph(requirement.id, { nodes, edges });
    if (graph) {
      setSelectedMemberId("all");
      navigate(`/requirements/${requirement.id}/graph`, { replace: true });
    }
  }

  return (
    <div className="page-stack new-requirement-page">
      <nav className="breadcrumbs" aria-label="面包屑">
        <Link to="/projects">
          <ArrowLeft aria-hidden="true" size={16} />
          项目
        </Link>
        <ChevronRight aria-hidden="true" size={14} />
        <span aria-current="page">新建需求</span>
      </nav>

      <header className="work-header reveal">
        <div className="work-header-main">
          <h1>新建需求</h1>
          <p>定义目标、验收标准和责任链，再编排初始工作图。提交后需求会立即出现在账本中。</p>
        </div>
      </header>

      <form
        className="new-requirement-form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        {validationErrors.length > 0 ? (
          <div className="validation-errors reveal" role="alert">
            <ul>
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {createdRequirement ? (
          <div className="partial-create-note" role="status">
            需求已经创建；如果工作图生成失败，再次提交只会重试工作图，不会重复创建需求。
          </div>
        ) : null}

        <section className="panel reveal reveal--2" aria-labelledby="new-req-scope">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Scope</p>
              <h2 id="new-req-scope">归属与目标</h2>
            </div>
          </div>

          <label className="field">
            <span>所属项目 <em>必选</em></span>
            <select required disabled={Boolean(createdRequirement)} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">请选择项目…</option>
              {snapshot.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.key} · {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>需求目标 <em>必填</em></span>
            <textarea
              required
              disabled={Boolean(createdRequirement)}
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="这项需求要达成什么结果？用一两句话说清楚。"
            />
          </label>
        </section>

        <section className="panel reveal reveal--2" aria-labelledby="new-req-criteria">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Definition of done</p>
              <h2 id="new-req-criteria">验收标准</h2>
            </div>
            <button type="button" className="icon-button" onClick={addCriterion} aria-label="添加验收标准" title="添加验收标准">
              <Plus aria-hidden="true" size={17} />
            </button>
          </div>
          <p className="section-hint">至少添加一条可验证的验收标准。每一条都应该是可被客观判断的。</p>
          <div className="criteria-editor">
            {criteria.map((criterion, index) => (
              <div key={index} className="criteria-row">
                <span className="criteria-index">{String(index + 1).padStart(2, "0")}</span>
                <input
                  value={criterion}
                  disabled={Boolean(createdRequirement)}
                  onChange={(e) => updateCriterion(index, e.target.value)}
                  placeholder={`验收标准 ${index + 1}`}
                  aria-label={`验收标准 ${index + 1}`}
                />
                {criteria.length > 1 ? (
                  <button
                    type="button"
                    className="icon-button criteria-remove"
                    onClick={() => removeCriterion(index)}
                    aria-label={`删除验收标准 ${index + 1}`}
                  >
                    <MinusCircle aria-hidden="true" size={17} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="panel reveal reveal--2" aria-labelledby="new-req-responsibility">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Responsibility chain</p>
              <h2 id="new-req-responsibility">责任分配</h2>
            </div>
          </div>
          <p className="section-hint">指定这条需求的三层责任人。需求创建后工作图节点会继承相同的责任链。</p>

          {unnamedWarning ? (
            <div className="unnamed-note" role="note">
              <Users aria-hidden="true" size={15} />
              <span>部分成员名称尚未实名，显示为"待实名"标签。实名后会自动更新。</span>
            </div>
          ) : null}

          <div className="responsibility-grid">
            <label className="field">
              <span>最终责任人 <em>必选</em></span>
              <select required disabled={Boolean(createdRequirement)} value={accountableId} onChange={(e) => setAccountableId(e.target.value)}>
                <option value="">请选择…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>日常负责人 <em>必选</em></span>
              <select required disabled={Boolean(createdRequirement)} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">请选择…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>当前执行人 <em>必选</em></span>
              <select required disabled={Boolean(createdRequirement)} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">请选择…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="panel reveal reveal--2" aria-labelledby="new-req-workitems">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Work graph seed</p>
              <h2 id="new-req-workitems">初始工作项</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={addWorkItem}
              disabled={workItems.length >= 5}
              aria-label="添加工作项"
              title={workItems.length >= 5 ? "最多 5 个工作项" : "添加工作项"}
            >
              <PlusCircle aria-hidden="true" size={17} />
            </button>
          </div>
          <p className="section-hint">
            定义 1–5 个顺序执行的工作项。提交时会自动生成硬依赖链（上游 → 下游），第一个节点创建后自动就绪。
          </p>
          <div className="work-items-editor">
            {workItems.map((item, index) => (
              <article key={index} className="work-item-draft">
                <span className="draft-index" aria-hidden="true">
                  <GripVertical size={15} />
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="draft-body">
                  <label className="field draft-title-field">
                    <span className="sr-only">工作项 {index + 1} 标题</span>
                    <input
                      value={item.title}
                      onChange={(e) => updateWorkItem(index, "title", e.target.value)}
                      placeholder={`工作项 ${index + 1} 标题${index === 0 ? "（至少填写一个）" : ""}`}
                      aria-label={`工作项 ${index + 1} 标题`}
                    />
                  </label>
                  <label className="check-field draft-required">
                    <input
                      type="checkbox"
                      checked={item.isRequired}
                      onChange={(e) => updateWorkItem(index, "isRequired", e.target.checked)}
                    />
                    <span>必需节点</span>
                  </label>
                </div>
                {workItems.length > 1 ? (
                  <button
                    type="button"
                    className="icon-button draft-remove"
                    onClick={() => removeWorkItem(index)}
                    aria-label={`删除工作项 ${index + 1}`}
                  >
                    <MinusCircle aria-hidden="true" size={17} />
                  </button>
                ) : null}
              </article>
            ))}
          </div>

          {workItems.filter((w) => w.title.trim()).length > 1 ? (
            <div className="dependency-preview" aria-label="依赖链预览">
              <Target aria-hidden="true" size={15} />
              <span>
                依赖链：{workItems.filter((w) => w.title.trim()).map((w) => w.title.trim()).join(" → ")}
              </span>
            </div>
          ) : null}
        </section>

        <div className="form-actions reveal reveal--3">
          <Link className="button button--secondary" to="/projects">
            取消
          </Link>
          <button className="button button--primary" type="submit" disabled={isBusy}>
            <Send aria-hidden="true" size={17} />
            {isBusy ? "创建中…" : createdRequirement ? "重试生成工作图" : "创建需求并生成工作图"}
          </button>
          <small className="action-footnote">
            需求创建后会立即生成工作图，并跳转至工作图页面。
          </small>
        </div>
      </form>
    </div>
  );
}
