import {
  Activity,
  FolderKanban,
  Gauge,
  GitBranch,
  Radio,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useHelm } from "../state/helm-context";

const navigation = [
  { to: "/", label: "今日", icon: Gauge, end: true },
  { to: "/projects", label: "项目", icon: FolderKanban },
  { to: "/requirements/req-42/graph", label: "工作图", icon: GitBranch },
  { to: "/releases", label: "发布", icon: ShieldCheck },
];

export function AppShell() {
  const { snapshot, loading, connection, notice, refresh, clearNotice } = useHelm();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>

      <aside className="sidebar" aria-label="主导航">
        <Brand />
        <nav className="primary-nav" aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="nav-link">
              <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="eyebrow">运行模式</p>
          <div className="mode-lockup">
            <Activity aria-hidden="true" size={18} />
            <span>Phase 0</span>
            <small>Human only</small>
          </div>
          <p className="sidebar-note">工作流不依赖 Agent，所有授权回到人。</p>
        </div>
      </aside>

      <div className="app-column">
        <header className="topbar">
          <div className="topbar-brand-mobile">
            <Brand />
          </div>
          <div className="workspace-identity">
            <span className="workspace-mark" aria-hidden="true" />
            <span>{snapshot?.organizationName ?? "Helm Studio"}</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => void refresh()}
              aria-label="刷新工作区"
              title="刷新工作区"
            >
              <RefreshCw aria-hidden="true" size={18} className={loading ? "spin" : undefined} />
            </button>
            <ConnectionBadge state={connection.state} />
          </div>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          {loading && !snapshot ? <LoadingState /> : <Outlet />}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="mobile-nav-link">
            <Icon aria-hidden="true" size={19} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {notice ? (
        <div
          className={`notice notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live={notice.tone === "error" ? "assertive" : "polite"}
        >
          <span>{notice.message}</span>
          <button type="button" onClick={clearNotice} aria-label="关闭通知">
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Brand() {
  return (
    <div className="brand" aria-label="Helm">
      <span className="brand-symbol" aria-hidden="true">
        H
      </span>
      <span className="brand-word">Helm</span>
    </div>
  );
}

function ConnectionBadge({ state }: { state: "connecting" | "live" | "reconnecting" | "offline" }) {
  const labels = {
    connecting: "连接中",
    live: "实时",
    reconnecting: "重连中",
    offline: "离线",
  };
  return (
    <div className={`connection connection--${state}`} role="status" aria-label={`实时连接：${labels[state]}`}>
      <Radio aria-hidden="true" size={15} />
      <span>{labels[state]}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span className="loading-orbit" aria-hidden="true" />
      <p>正在整理需要你关注的事项…</p>
    </div>
  );
}
