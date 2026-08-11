import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createHelmClient, type ConnectionState, type HelmClient } from "../api/client";
import type { ReleaseApprovalInput, ResultInput, ReviewInput, WorkspaceSnapshot } from "../domain";

interface Notice {
  tone: "success" | "error";
  message: string;
}

interface HelmContextValue {
  snapshot: WorkspaceSnapshot | null;
  loading: boolean;
  busyAction: string | null;
  connection: ConnectionState;
  notice: Notice | null;
  refresh(): Promise<void>;
  beginExecution(workItemId: string, version: number): Promise<boolean>;
  submitResult(workItemId: string, version: number, input: ResultInput): Promise<boolean>;
  reviewResult(workItemId: string, version: number, input: ReviewInput): Promise<boolean>;
  addComment(workItemId: string, version: number, body: string): Promise<boolean>;
  approveRelease(releaseId: string, input: ReleaseApprovalInput): Promise<boolean>;
  clearNotice(): void;
}

const HelmContext = createContext<HelmContextValue | null>(null);

interface HelmProviderProps {
  children: ReactNode;
  client?: HelmClient;
}

export function HelmProvider({ children, client: providedClient }: HelmProviderProps) {
  const clientRef = useRef<HelmClient>(providedClient ?? createHelmClient());
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ state: "connecting" });

  const refresh = useCallback(async () => {
    try {
      const nextSnapshot = await clientRef.current.loadWorkspace();
      setSnapshot(nextSnapshot);
    } catch (error) {
      setNotice({ tone: "error", message: toMessage(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return clientRef.current.subscribe(
      (event) => {
        if (event.type === "workspace.updated") void refresh();
      },
      setConnection,
    );
  }, [refresh]);

  const runAction = useCallback(
    async (key: string, successMessage: string, action: () => Promise<void>): Promise<boolean> => {
      setBusyAction(key);
      setNotice(null);
      try {
        await action();
        await refresh();
        setNotice({ tone: "success", message: successMessage });
        return true;
      } catch (error) {
        setNotice({ tone: "error", message: toMessage(error) });
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [refresh],
  );

  const value = useMemo<HelmContextValue>(
    () => ({
      snapshot,
      loading,
      busyAction,
      connection,
      notice,
      refresh,
      beginExecution: (workItemId, version) =>
        runAction(`begin:${workItemId}`, "执行已开始，Timeline 已记录。", () =>
          clientRef.current.beginExecution(workItemId, version),
        ),
      submitResult: (workItemId, version, input) =>
        runAction(`result:${workItemId}`, "结构化 Result 已提交审核。", () =>
          clientRef.current.submitResult(workItemId, version, input),
        ),
      reviewResult: (workItemId, version, input) =>
        runAction(`review:${workItemId}`, input.decision === "approve" ? "Result 已通过。" : "已退回返工。", () =>
          clientRef.current.reviewResult(workItemId, version, input),
        ),
      addComment: (workItemId, version, body) =>
        runAction(`comment:${workItemId}`, "说明已加入 Timeline。", () =>
          clientRef.current.addComment(workItemId, version, body),
        ),
      approveRelease: (releaseId, input) =>
        runAction(`release:${releaseId}`, "发布授权已记录为审计事件。", () =>
          clientRef.current.approveRelease(releaseId, input),
        ),
      clearNotice: () => setNotice(null),
    }),
    [busyAction, connection, loading, notice, refresh, runAction, snapshot],
  );

  return <HelmContext.Provider value={value}>{children}</HelmContext.Provider>;
}

export function useHelm(): HelmContextValue {
  const value = useContext(HelmContext);
  if (!value) throw new Error("useHelm must be used within HelmProvider");
  return value;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

