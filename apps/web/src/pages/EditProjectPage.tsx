import { ArrowLeft, ChevronRight, Save, Trash2, Users, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useHelm } from "../state/helm-context";

export function EditProjectPage() {
  const { snapshot, busyAction, updateProject, deleteProject } = useHelm();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const project = snapshot?.projects.find((p) => p.id === projectId);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [accountableId, setAccountableId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setSlug(project.slug);
    setDescription(project.description);
    setAccountableId(project.accountableHuman?.id ?? "");
    setOwnerId(project.operationalOwner?.id ?? "");
    setShowDeleteConfirm(false);
    setValidationErrors([]);
  }, [project?.id]);

  if (!snapshot) return null;

  if (!project) return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="面包屑">
        <Link to="/projects"><ArrowLeft aria-hidden="true" size={16} />项目</Link>
        <ChevronRight aria-hidden="true" size={14} />
        <span aria-current="page">未找到项目</span>
      </nav>
    </div>
  );

  const members = snapshot.members;
  const unnamedWarning = members.some((member) => member.name.endsWith("（待实名）"));
  const isBusy = busyAction === "update-project" || busyAction === "delete-project";

  function validate(): boolean {
    const errors: string[] = [];
    if (!name.trim()) errors.push("请填写项目名称。");
    if (!slug.trim()) errors.push("请填写项目标识（slug）。");
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
      errors.push("项目标识只能使用小写英文字母、数字和单个短横线。");
    }
    if (!accountableId) errors.push("请指定最终责任人。");
    if (!ownerId) errors.push("请指定日常负责人。");
    setValidationErrors(errors);
    return errors.length === 0;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;

    const result = await updateProject(projectId!, {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || name.trim(),
      accountableHumanId: accountableId,
      operationalOwnerId: ownerId,
    });

    if (result) {
      navigate("/projects", { replace: true });
    }
  }

  async function handleDelete() {
    const success = await deleteProject(projectId!);
    if (success) {
      navigate("/projects", { replace: true });
    }
  }

  const hasRequirements = snapshot.requirements.some((req) => req.projectId === projectId);

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="面包屑">
        <Link to="/projects">
          <ArrowLeft aria-hidden="true" size={16} />
          项目
        </Link>
        <ChevronRight aria-hidden="true" size={14} />
        <span aria-current="page">管理项目 · {project.key}</span>
      </nav>

      <header className="work-header reveal">
        <div className="work-header-main">
          <h1>管理项目</h1>
          <p>修改项目信息或删除项目。删除前需确保项目下没有需求。</p>
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

        <section className="panel reveal reveal--2" aria-labelledby="edit-project-identity">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Identity</p>
              <h2 id="edit-project-identity">项目名称与标识</h2>
            </div>
          </div>

          <label className="field">
            <span>项目名称 <em>必填</em></span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目名称"
              aria-label="项目名称"
            />
          </label>

          <label className="field">
            <span>项目标识（slug） <em>必填</em></span>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="helm-workflow-os"
              aria-label="项目标识 slug"
            />
          </label>

          <label className="field">
            <span>项目描述</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目描述"
              aria-label="项目描述"
            />
          </label>
        </section>

        <section className="panel reveal reveal--2" aria-labelledby="edit-project-responsibility">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Responsibility</p>
              <h2 id="edit-project-responsibility">责任分配</h2>
            </div>
          </div>

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
          </div>
        </section>

        <div className="form-actions reveal reveal--3">
          <Link className="button button--secondary" to="/projects">
            取消
          </Link>
          <button className="button button--primary" type="submit" disabled={isBusy}>
            <Save aria-hidden="true" size={17} />
            {busyAction === "update-project" ? "保存中…" : "保存修改"}
          </button>
        </div>
      </form>

      <section className="panel reveal reveal--4" aria-labelledby="delete-project-section" style={{ borderColor: "var(--red-soft)" }}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow" style={{ color: "var(--red)" }}>Danger zone</p>
            <h2 id="delete-project-section">删除项目</h2>
          </div>
        </div>
        <p className="section-hint">
          删除项目将从工作区移除该项目及其元数据。
          {hasRequirements ? (
            <strong style={{ display: "block", marginBlockStart: "0.35rem", color: "var(--red)" }}>
              该项目下仍有 {snapshot.requirements.filter((r) => r.projectId === projectId).length} 项需求，无法删除。请先移除或转移项目下的所有需求。
            </strong>
          ) : (
            <span style={{ display: "block", marginBlockStart: "0.35rem", color: "var(--ink-soft)" }}>
              项目下没有需求，可以安全删除。删除操作不可撤销。
            </span>
          )}
        </p>

        {!showDeleteConfirm ? (
          <button
            className="button button--danger"
            type="button"
            disabled={hasRequirements}
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 aria-hidden="true" size={16} />
            删除项目
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
            <span style={{ color: "var(--red)", fontSize: "0.75rem", fontWeight: 650 }}>
              确认删除项目「{project.name}」？此操作不可撤销。
            </span>
            <button
              className="button button--danger"
              type="button"
              disabled={isBusy}
              onClick={() => void handleDelete()}
            >
              <Trash2 aria-hidden="true" size={16} />
              {busyAction === "delete-project" ? "删除中…" : "确认删除"}
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
