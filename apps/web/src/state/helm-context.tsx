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
import type { CreateProjectInput, CreateRequirementInput, CreateWorkGraphInput, Project, ReleaseApprovalInput, Requirement, ResultInput, ReviewInput, UpdateProjectInput, UpdateRequirementInput, WorkGraph, WorkspaceSnapshot } from "../domain";

const PERSPECTIVE_KEY = "helm:perspective:selectedMemberId";

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
  selectedMemberId: string;
  setSelectedMemberId(id: string): void;
  refresh(): Promise<void>;
  createRequirement(input: CreateRequirementInput): Promise<Requirement | null>;
  createWorkGraph(requirementId: string, input: CreateWorkGraphInput): Promise<WorkGraph | null>;
  beginExecution(workItemId: string, version: number): Promise<boolean>;
  submitResult(workItemId: string, version: number, input: ResultInput): Promise<boolean>;
  reviewResult(workItemId: string, version: number, input: ReviewInput): Promise<boolean>;
  addComment(workItemId: string, version: number, body: string): Promise<boolean>;
  approveRelease(releaseId: string, input: ReleaseApprovalInput): Promise<boolean>;
  createProject(input: CreateProjectInput): Promise<Project | null>;
  updateProject(id: string, input: UpdateProjectInput): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;
  updateRequirement(id: string, input: UpdateRequirementInput): Promise<Requirement | null>;
  deleteRequirement(id: string): Promise<boolean>;
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
  const [selectedMemberId, setSelectedMemberId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(PERSPECTIVE_KEY) ?? "all";
    } catch {
      return "all";
    }
  });

  const persistMemberId = useCallback((id: string) => {
    setSelectedMemberId(id);
    try {
      window.localStorage.setItem(PERSPECTIVE_KEY, id);
    } catch {
      // localStorage unavailable
    }
  }, []);

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
    let disposed = false;
    let unsubscribe = () => {};
    void refresh().then(() => {
      if (disposed) return;
      unsubscribe = clientRef.current.subscribe(
        (event) => {
          if (event.type === "workspace.updated") void refresh();
        },
        setConnection,
      );
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    if (
      snapshot &&
      selectedMemberId !== "all" &&
      !snapshot.members.some((member) => member.id === selectedMemberId)
    ) {
      persistMemberId("all");
    }
  }, [persistMemberId, selectedMemberId, snapshot]);

  const filteredSnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (selectedMemberId === "all") return snapshot;
    return filterSnapshotByMember(snapshot, selectedMemberId);
  }, [snapshot, selectedMemberId]);

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
      snapshot: filteredSnapshot,
      loading,
      busyAction,
      connection,
      notice,
      selectedMemberId,
      setSelectedMemberId: persistMemberId,
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
      createRequirement: async (input) => {
        setBusyAction("create-requirement");
        setNotice(null);
        try {
          const req = await clientRef.current.createRequirement(input);
          await refresh();
          setNotice({ tone: "success", message: `需求 ${req.key} 已创建。` });
          return req;
        } catch (error) {
          setNotice({ tone: "error", message: toMessage(error) });
          return null;
        } finally {
          setBusyAction(null);
        }
      },
      createWorkGraph: async (requirementId, input) => {
        setBusyAction("create-graph");
        setNotice(null);
        try {
          const graph = await clientRef.current.createWorkGraph(requirementId, input);
          await refresh();
          setNotice({ tone: "success", message: "工作图已生成，首个节点已就绪。" });
          return graph;
        } catch (error) {
          setNotice({ tone: "error", message: toMessage(error) });
          return null;
        } finally {
          setBusyAction(null);
        }
      },
      createProject: async (input) => {
        setBusyAction("create-project");
        setNotice(null);
        try {
          const project = await clientRef.current.createProject(input);
          await refresh();
          setNotice({ tone: "success", message: `项目 ${project.key} 已创建。` });
          return project;
        } catch (error) {
          setNotice({ tone: "error", message: toMessage(error) });
          return null;
        } finally {
          setBusyAction(null);
        }
      },
      updateProject: async (id, input) => {
        setBusyAction("update-project");
        setNotice(null);
        try {
          const project = await clientRef.current.updateProject(id, input);
          await refresh();
          setNotice({ tone: "success", message: "项目信息已更新。" });
          return project;
        } catch (error) {
          setNotice({ tone: "error", message: toMessage(error) });
          return null;
        } finally {
          setBusyAction(null);
        }
      },
      deleteProject: async (id) => {
        return runAction("delete-project", "项目已删除。", () =>
          clientRef.current.deleteProject(id),
        );
      },
      updateRequirement: async (id, input) => {
        setBusyAction("update-requirement");
        setNotice(null);
        try {
          const req = await clientRef.current.updateRequirement(id, input);
          await refresh();
          setNotice({ tone: "success", message: "需求信息已更新。" });
          return req;
        } catch (error) {
          setNotice({ tone: "error", message: toMessage(error) });
          return null;
        } finally {
          setBusyAction(null);
        }
      },
      deleteRequirement: async (id) => {
        return runAction("delete-requirement", "需求已删除。", () =>
          clientRef.current.deleteRequirement(id),
        );
      },
    }),
    [busyAction, connection, filteredSnapshot, loading, notice, persistMemberId, refresh, runAction, selectedMemberId],
  );

  return <HelmContext.Provider value={value}>{children}</HelmContext.Provider>;
}

export function useHelm(): HelmContextValue {
  const value = useContext(HelmContext);
  if (!value) throw new Error("useHelm must be used within HelmProvider");
  return value;
}

function matchesMember(requirement: WorkspaceSnapshot["requirements"][number], memberId: string): boolean {
  return (
    requirement.accountableHuman.id === memberId ||
    requirement.operationalOwner.id === memberId ||
    requirement.assignee.id === memberId
  );
}

function filterSnapshotByMember(
  snapshot: WorkspaceSnapshot,
  memberId: string,
): WorkspaceSnapshot {
  const visibleRequirements = snapshot.requirements.filter((req) => matchesMember(req, memberId));
  const visibleRequirementIds = new Set(visibleRequirements.map((req) => req.id));

  const visibleWorkItems = snapshot.workItems.filter(
    (item) =>
      item.responsibilities.accountableHuman.id === memberId ||
      item.responsibilities.operationalOwner.id === memberId ||
      item.responsibilities.assignee.id === memberId,
  );
  const visibleWorkItemIds = new Set(visibleWorkItems.map((item) => item.id));

  const visibleGraphs = snapshot.graphs.filter((graph) => visibleRequirementIds.has(graph.requirementId));

  const visibleReleases = snapshot.releases.filter((release) =>
    release.requirementIds.some((reqId) => visibleRequirementIds.has(reqId)),
  );

  const visibleAttention = snapshot.attention.filter((item) => {
    if (item.workItemId && visibleWorkItemIds.has(item.workItemId)) return true;
    return item.requirementIds?.some((requirementId) => visibleRequirementIds.has(requirementId)) ?? false;
  });

  const visibleEvents = snapshot.recentEvents.filter((event) => {
    if (event.actor.id === memberId) return true;
    return event.workItemId ? visibleWorkItemIds.has(event.workItemId) : false;
  });

  const projects = snapshot.projects.map((project) => {
    const projectRequirements = visibleRequirements.filter((req) => req.projectId === project.id);
    const projectAttention = visibleAttention.filter((item) => {
      if (item.requirementIds?.some((id) => projectRequirements.some((req) => req.id === id))) {
        return true;
      }
      const workItem = item.workItemId
        ? visibleWorkItems.find((candidate) => candidate.id === item.workItemId)
        : undefined;
      return workItem ? projectRequirements.some((req) => req.id === workItem.requirementId) : false;
    });
    const progress = projectRequirements.length
      ? Math.round(projectRequirements.reduce((sum, req) => sum + req.progress, 0) / projectRequirements.length)
      : 0;
    return {
      ...project,
      activeRequirementCount: projectRequirements.filter((req) => req.status !== "completed").length,
      attentionCount: projectAttention.length,
      progress,
    };
  });

  return {
    ...snapshot,
    projects,
    requirements: visibleRequirements,
    graphs: visibleGraphs,
    workItems: visibleWorkItems,
    releases: visibleReleases,
    attention: visibleAttention,
    recentEvents: visibleEvents,
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
