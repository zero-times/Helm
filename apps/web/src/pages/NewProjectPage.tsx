import { ArrowLeft, ChevronRight, Send, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useHelm } from "../state/helm-context";

export function NewProjectPage() {
  const { snapshot, busyAction, createProject } = useHelm();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [accountableId, setAccountableId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  if (!snapshot) return null;

  const members = snapshot.members;
  const unnamedWarning = members.some((member) => member.name.endsWith("（待实名）"));
  const isBusy = busyAction === "create-project";

  function deriveSlug(value: string) {
    if (slugManual) return;
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48),
    );
  }

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;

    const project = await createProject({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || name.trim(),
      accountableHumanId: accountableId,
      operationalOwnerId: ownerId,
    });

    if (project) {
      navigate("/projects", { replace: true });
    }
  }

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="面包屑">
        <Link to="/projects">
          <ArrowLeft aria-hidden="true" size={16} />
          项目
        </Link>
        <ChevronRight aria-hidden="true" size={14} />
        <span aria-current="page">新建项目</span>
      </nav>

      <header className="work-header reveal">
        <div className="work-header-main">
          <h1>新建项目</h1>
          <p>项目是需求的归属容器，定义名称、标识和负责人后即可承载需求。</p>
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

        <section className="panel reveal reveal--2" aria-labelledby="new-project-identity">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Identity</p>
              <h2 id="new-project-identity">项目名称与标识</h2>
            </div>
          </div>

          <label className="field">
            <span>项目名称 <em>必填</em></span>
            <input
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                deriveSlug(e.target.value);
              }}
              placeholder="例如：Helm Workflow OS"
              aria-label="项目名称"
            />
          </label>

          <label className="field">
            <span>项目标识（slug） <em>必填，稳定小写</em></span>
            <input
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugManual(true);
              }}
              placeholder="例如：helm-workflow-os"
              aria-label="项目标识 slug"
            />
            <small style={{ color: "var(--ink-faint)", fontSize: "0.63rem", marginBlockStart: "0.15rem" }}>
              用于 URL 和 key 前缀；建议使用全小写英文与短横线，创建后可作为唯一引用。
            </small>
          </label>

          <label className="field">
            <span>项目描述</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目的目标或一句话说明（留空则使用项目名称）"
              aria-label="项目描述"
            />
          </label>
        </section>

        <section className="panel reveal reveal--2" aria-labelledby="new-project-responsibility">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Responsibility</p>
              <h2 id="new-project-responsibility">责任分配</h2>
            </div>
          </div>
          <p className="section-hint">指定项目的两层责任人。项目下的需求可继承这些默认值。</p>

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
            <Send aria-hidden="true" size={17} />
            {isBusy ? "创建中…" : "创建项目"}
          </button>
        </div>
      </form>
    </div>
  );
}
