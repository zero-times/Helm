import {
  AlertTriangle,
  Check,
  CircleDashed,
  CircleDot,
  Clock3,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { RequirementStatus, WorkItemStatus } from "../domain";

type Status = RequirementStatus | WorkItemStatus | "assembling" | "waiting_approval" | "approved" | "released";

const statusMeta: Record<Status, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "neutral" },
  ready: { label: "已就绪", tone: "ready" },
  running: { label: "执行中", tone: "active" },
  in_progress: { label: "推进中", tone: "active" },
  waiting_review: { label: "待审核", tone: "decision" },
  ready_for_release: { label: "待发布", tone: "ready" },
  rework: { label: "待返工", tone: "warning" },
  blocked: { label: "阻塞", tone: "danger" },
  completed: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
  assembling: { label: "组装中", tone: "active" },
  waiting_approval: { label: "待授权", tone: "decision" },
  approved: { label: "已授权", tone: "success" },
  released: { label: "已发布", tone: "success" },
};

export function StatusPill({ status }: { status: Status }) {
  const meta = statusMeta[status];
  const Icon = statusIcon(status);
  return (
    <span className={`status-pill status-pill--${meta.tone}`}>
      <Icon aria-hidden="true" size={13} />
      {meta.label}
    </span>
  );
}

function statusIcon(status: Status) {
  if (status === "completed" || status === "approved" || status === "released") return Check;
  if (status === "blocked") return XCircle;
  if (status === "rework") return RotateCcw;
  if (status === "waiting_review" || status === "waiting_approval") return Clock3;
  if (status === "running" || status === "in_progress" || status === "assembling") return CircleDot;
  if (status === "ready" || status === "ready_for_release") return AlertTriangle;
  return CircleDashed;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress-wrap">
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label ?? "完成进度"}
      >
        <span style={{ inlineSize: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="progress-value">{value}%</span>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header reveal">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action ? <div className="page-header-action">{action}</div> : null}
    </header>
  );
}

export function Initials({ initials, label }: { initials: string; label: string }) {
  return (
    <span className="initials" aria-label={label} title={label}>
      {initials}
    </span>
  );
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("zh-CN", options ?? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

