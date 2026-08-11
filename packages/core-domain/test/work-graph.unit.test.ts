import { describe, expect, it } from 'vitest';

import {
  DependencyNotSatisfiedError,
  InvalidStateTransitionError,
  RequirementStatus,
  WorkItemStatus,
  assertWorkItemTransition,
  deriveRequirementStatus,
} from '../src/index';

describe('work item state machine', () => {
  it('accepts the normal execution path', () => {
    expect(() => assertWorkItemTransition('pending', 'ready')).not.toThrow();
    expect(() => assertWorkItemTransition('ready', 'in_progress')).not.toThrow();
    expect(() => assertWorkItemTransition('in_progress', 'completed')).not.toThrow();
  });

  it('rejects ready while a hard dependency is incomplete', () => {
    expect(() => assertWorkItemTransition('pending', 'ready', false)).toThrow(
      DependencyNotSatisfiedError,
    );
  });

  it('rejects illegal and terminal-state transitions', () => {
    expect(() => assertWorkItemTransition('pending', 'completed')).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => assertWorkItemTransition('completed', 'in_progress')).toThrow(
      InvalidStateTransitionError,
    );
  });
});

describe('requirement status derivation', () => {
  it('uses required nodes only', () => {
    expect(
      deriveRequirementStatus([
        { isRequired: true, status: WorkItemStatus.Completed },
        { isRequired: false, status: WorkItemStatus.Failed },
      ]),
    ).toBe(RequirementStatus.Completed);
  });

  it('derives blocked and in-progress states', () => {
    expect(
      deriveRequirementStatus([{ isRequired: true, status: WorkItemStatus.Failed }]),
    ).toBe(RequirementStatus.Blocked);
    expect(
      deriveRequirementStatus([
        { isRequired: true, status: WorkItemStatus.Completed },
        { isRequired: true, status: WorkItemStatus.Ready },
      ]),
    ).toBe(RequirementStatus.InProgress);
  });
});
