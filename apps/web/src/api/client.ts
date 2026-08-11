import type {
  LiveEvent,
  ReleaseApprovalInput,
  ResultInput,
  ReviewInput,
  WorkspaceSnapshot,
} from "../domain";
import { HttpHelmClient } from "./http-client";
import { MockHelmClient } from "./mock-client";

export interface ConnectionState {
  state: "connecting" | "live" | "reconnecting" | "offline";
  lastEventAt?: string;
}

export interface HelmClient {
  loadWorkspace(): Promise<WorkspaceSnapshot>;
  beginExecution(workItemId: string, expectedVersion: number): Promise<void>;
  submitResult(workItemId: string, expectedVersion: number, input: ResultInput): Promise<void>;
  reviewResult(workItemId: string, expectedVersion: number, input: ReviewInput): Promise<void>;
  addComment(workItemId: string, expectedVersion: number, body: string): Promise<void>;
  approveRelease(releaseId: string, input: ReleaseApprovalInput): Promise<void>;
  subscribe(
    onEvent: (event: LiveEvent) => void,
    onConnectionChange: (state: ConnectionState) => void,
  ): () => void;
}

export function createHelmClient(): HelmClient {
  const configuredMode = import.meta.env.VITE_DATA_MODE as string | undefined;
  const shouldMock = configuredMode !== "api";

  return shouldMock
    ? new MockHelmClient()
    : new HttpHelmClient(import.meta.env.VITE_API_BASE_URL || "");
}

