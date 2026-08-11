import {
  DependencyNotSatisfiedError,
  InvalidStateTransitionError,
} from './errors';

export const WorkItemStatus = {
  Pending: 'pending',
  Ready: 'ready',
  InProgress: 'in_progress',
  Completed: 'completed',
  Failed: 'failed',
  Canceled: 'canceled',
} as const;

export type WorkItemStatus =
  (typeof WorkItemStatus)[keyof typeof WorkItemStatus];

export const RequirementStatus = {
  Planned: 'planned',
  InProgress: 'in_progress',
  Blocked: 'blocked',
  Completed: 'completed',
  Canceled: 'canceled',
} as const;

export type RequirementStatus =
  (typeof RequirementStatus)[keyof typeof RequirementStatus];

export interface GraphNodeState {
  isRequired: boolean;
  status: WorkItemStatus;
}

const allowedTransitions: Readonly<Record<WorkItemStatus, readonly WorkItemStatus[]>> = {
  pending: [WorkItemStatus.Ready, WorkItemStatus.Canceled],
  ready: [WorkItemStatus.InProgress, WorkItemStatus.Canceled],
  in_progress: [
    WorkItemStatus.Completed,
    WorkItemStatus.Failed,
    WorkItemStatus.Canceled,
  ],
  failed: [WorkItemStatus.Ready, WorkItemStatus.Canceled],
  completed: [],
  canceled: [],
};

export function assertWorkItemTransition(
  from: WorkItemStatus,
  to: WorkItemStatus,
  hardDependenciesSatisfied = true,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
  if (to === WorkItemStatus.Ready && !hardDependenciesSatisfied) {
    throw new DependencyNotSatisfiedError();
  }
}

export function deriveRequirementStatus(
  nodes: readonly GraphNodeState[],
): RequirementStatus {
  const required = nodes.filter((node) => node.isRequired);
  if (required.length === 0) return RequirementStatus.Planned;
  if (required.every((node) => node.status === WorkItemStatus.Completed)) {
    return RequirementStatus.Completed;
  }
  if (required.every((node) => node.status === WorkItemStatus.Canceled)) {
    return RequirementStatus.Canceled;
  }
  if (required.some((node) => node.status === WorkItemStatus.Failed)) {
    return RequirementStatus.Blocked;
  }
  if (
    required.some(
      (node) =>
        node.status === WorkItemStatus.InProgress ||
        node.status === WorkItemStatus.Completed,
    )
  ) {
    return RequirementStatus.InProgress;
  }
  return RequirementStatus.Planned;
}
