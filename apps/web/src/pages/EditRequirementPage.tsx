import {
  ArrowLeft,
  ChevronRight,
  MinusCircle,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useHelm } from "../state/helm-context";

export function EditRequirementPage() {
  const { snapshot, busyAction, updateRequirement, deleteRequirement } = useHelm();
  const navigate = useNavigate();
  const { requirementId } = useParams<{ requirementId: string }>();

  const requirement = snapshot?.requirements.find((r) => r.id === requirementId);
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [accountableId, setAccountableId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!requirement) return;
    setGoal(requirement.objective);
    setCriteria(
      requirement.acceptanceCriteria.length
        ? [...requirement.acceptanceCriteria]
        : [""],
    );
    setAccountableId(requirement.accountableHuman.id);
    setOwnerId(requirement.operationalOwner.id);
    setAssigneeId(requirement.assignee.id);
    setShowDeleteConfirm(false);
    setValidationErrors([]);
  }, [requirement?.id]);

  if (!snapshot) return null;

  if (!requirement) return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="面包屑">
        <Link to="/projects"><ArrowLeft aria-hidden="true" size={16} />项目</Link>
        <ChevronRight aria-hidden="true" size={14} />
        <span aria-current="page">未找到需求</span>
      </nav>
    </div>
  );

  const members = snapshot.members;
  const unnamedWarning = members.some((member) => member.name.endsWith("（待实名）"));
  const isBusy = busyAction === "update-requirement" || busyAction === "delete-requirement";

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

  function validate(): boolean {
    const errors: string[] = [];
    if (!goal.trim()) errors.push("请填写需求目标。");
    const filledCriteria = criteria.filter((c) => c.trim());
    if (!filledCriteria.length) errors.push("请至少填写一条验收标准。");
    if (!accountableId) errors.push("请指定最终责任人。");
    if (!ownerId) errors.push("请指定日常负责人。");
    if (!assigneeId) errors.push("请指定当前执行人。");
    setValidationErrors(errors);
    return errors.length === 0;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;

    const filledCriteria = criteria.filter((c) => c.trim());
    const result = await updateRequirement(requirementId!, {
      goal: goal.trim(),
      acceptanceCriteria: filledCriteria,
      accountableHumanId: accountableId,
      operationalOwnerId: ownerId,
      assigneeMemberId: assigneeId,
    });

    if (result) {
      navigate("/projects", { replace: true });
    }
  }

  async function handleDelete() {
    const success = await deleteRequirement(requirementId!);
    if (success) {
      navigate("/projects", { replace: true });
    }
  }

  const hasGraph = snapshot.graphs.some((g) => g.requirementId === requirementId);

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="面包屑">
        <Link to="/projects">
          <ArrowLeft aria-hidden="true" size={16} />
          项目
        </Link>
        <ChevronRight aria-hidden="true" size={14} />
        <span aria-current="page">编辑需求 · {requirement.key}</span>
      </nav>

      <header className="work-header reveal">
        <div className="work-header-main">
          <h1>编辑需求</h1>
          <p>修改需求的目标、验收标准和责任分配，或删除需求。</p>
        </div>
      </header>

      <form
        className="new-requirement-form"
        onSubmit={(event) => void handleSave(event)}
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

        <section className="panel reveal reveal--2" aria-labelledby="edit-req-scope">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Scope</p>
              <h2 id="edit-req-scope">目标</h2>
            </div>
          </div>

          <label className="field">
            <span>需求目标 <em>必填</em></span>
            <textarea
              required
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="这项需求要达成什么结果？"
              aria-label="需求目标"
            />
          </label>
        </section>

        <section className="panel reveal reveal--2" aria-labelledby="edit-req-criteria">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Definition of done</p>
              <h2 id="edit-req-criteria">验收标准</h2>
            </div>
            <button type="button" className="icon-button" onClick={addCriterion} aria-label="添加验收标准" title="添加验收标准">
              <Plus aria-hidden="true" size={17} />
            </button>
          </div>
          <p className="section-hint">每一条验收标准都应该是可被客观判断的。</p>
          <div className="criteria-editor">
            {criteria.map((criterion, index) => (
              <div key={index} className="criteria-row">
                <span className="criteria-index">{String(index + 1).padStart(2, "0")}</span>
                <input
                  value={criterion}
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

        <section className="panel reveal reveal--2" aria-labelledby="edit-req-responsibility">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Responsibility chain</p>
              <h2 id="edit-req-responsibility">责任分配</h2>
            </div>
          </div>
          <p className="section-hint">修改需求的三层责任人。</p>

          {unnamedWarning ? (
            <div className="unnamed-note" role="note">
              <Users aria-hidden="true" size={15} />
              <span>部分成员名称尚未实名，显示为"待实名"标签。实名后会自动更新。</span>
            </div>
          ) : null}

          <div className="responsibility-grid">
            <label className="field">
              <span>最终责任人 <em>必选</em></span>
              <select required value={accountableId} onChange={(e) => setAccountableId(e.target.value)}>
                <option value="">请选择…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>日常负责人 <em>必选</em></span>
              <select required value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">请选择…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>当前执行人 <em>必选</em></span>
              <select required value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">请选择…</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <div className="form-actions reveal reveal--3">
          <Link className="button button--secondary" to="/projects">
            取消
          </Link>
          <button className="button button--primary" type="submit" disabled={isBusy}>
            <Save aria-hidden="true" size={17} />
            {busyAction === "update-requirement" ? "保存中…" : "保存修改"}
          </button>
        </div>
      </form>

      <section className="panel reveal reveal--4" aria-labelledby="delete-req-section" style={{ borderColor: "var(--red-soft)" }}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow" style={{ color: "var(--red)" }}>Danger zone</p>
            <h2 id="delete-req-section">删除需求</h2>
          </div>
        </div>
        <p className="section-hint">
          {hasGraph ? (
            <strong style={{ display: "block", marginBlockStart: "0.35rem", color: "var(--red)" }}>
              该需求已有工作图和执行历史；删除会导致审计链不完整，因此必须保留 Timeline，不能删除。
            </strong>
          ) : (
            <span style={{ display: "block", color: "var(--ink-soft)" }}>
              该需求尚无工作图，可以安全删除。删除后需求将从账本中移除，不可恢复。
            </span>
          )}
        </p>

        {!showDeleteConfirm ? (
          <button
            className="button button--danger"
            type="button"
            disabled={hasGraph}
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 aria-hidden="true" size={16} />
            删除需求
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
            <span style={{ color: "var(--red)", fontSize: "0.75rem", fontWeight: 650 }}>
              确认删除需求「{requirement.key} {requirement.title}」？此操作不可撤销。
            </span>
            <button
              className="button button--danger"
              type="button"
              disabled={isBusy}
              onClick={() => void handleDelete()}
            >
              <Trash2 aria-hidden="true" size={16} />
              {busyAction === "delete-requirement" ? "删除中…" : "确认删除"}
            </button>
            <button
              className="button button--secondary"
              type="button"
              disabled={isBusy}
              onClick={() => setShowDeleteConfirm(false)}
            >
              <X aria-hidden="true" size={16} />
              取消
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
