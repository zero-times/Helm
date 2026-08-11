import type {
  LiveEvent,
  ReleaseApprovalInput,
  ResultInput,
  ReviewInput,
  WorkspaceSnapshot,
} from "../domain";
import type { ConnectionState, HelmClient } from "./client";

export class HttpHelmClient implements HelmClient {
  constructor(private readonly baseUrl: string) {}

  loadWorkspace(): Promise<WorkspaceSnapshot> {
    return this.request<WorkspaceSnapshot>("/api/v1/dashboard");
  }

  beginExecution(workItemId: string, expectedVersion: number): Promise<void> {
    return this.command(`/api/v1/work-items/${workItemId}/executions`, expectedVersion, {
      mode: "self",
    });
  }

  submitResult(workItemId: string, expectedVersion: number, input: ResultInput): Promise<void> {
    return this.command(`/api/v1/work-items/${workItemId}/results`, expectedVersion, input);
  }

  reviewResult(workItemId: string, expectedVersion: number, input: ReviewInput): Promise<void> {
    return this.command(`/api/v1/work-items/${workItemId}/reviews`, expectedVersion, input);
  }

  addComment(workItemId: string, expectedVersion: number, body: string): Promise<void> {
    return this.command(`/api/v1/work-items/${workItemId}/comments`, expectedVersion, { body });
  }

  approveRelease(releaseId: string, input: ReleaseApprovalInput): Promise<void> {
    return this.request<void>(`/api/v1/releases/${releaseId}/gate`, {
      method: "POST",
      headers: this.commandHeaders(),
      body: JSON.stringify({ decision: "approve", ...input }),
    });
  }

  subscribe(
    onEvent: (event: LiveEvent) => void,
    onConnectionChange: (state: ConnectionState) => void,
  ): () => void {
    onConnectionChange({ state: "connecting" });
    const events = new EventSource(`${this.baseUrl}/api/v1/events`);

    events.onopen = () => onConnectionChange({ state: "live", lastEventAt: new Date().toISOString() });
    events.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      onConnectionChange({ state: "live", lastEventAt: event.occurredAt });
      onEvent(event);
    };
    events.onerror = () => onConnectionChange({ state: "reconnecting" });

    return () => events.close();
  }

  private command(path: string, expectedVersion: number, body: unknown): Promise<void> {
    return this.request<void>(path, {
      method: "POST",
      headers: this.commandHeaders(expectedVersion),
      body: JSON.stringify(body),
    });
  }

  private commandHeaders(expectedVersion?: number): HeadersInit {
    return {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      ...(expectedVersion === undefined ? {} : { "If-Match": String(expectedVersion) }),
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: "same-origin",
      ...init,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `请求失败（${response.status}）`);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

