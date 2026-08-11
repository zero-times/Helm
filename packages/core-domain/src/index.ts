// Domain errors
export {
  AccountableHumanRequiredError,
  ConflictError,
  CrossOrganizationError,
  DependencyNotSatisfiedError,
  DomainError,
  InvalidStateTransitionError,
  NonEmptyFieldRequiredError,
  NotFoundError,
  ValidationError,
} from './errors';

// Domain types
export {
  MemberType,
  RoleType,
  type CreateMemberInput,
  type CreateOrganizationInput,
  type CreateProjectInput,
  type CreateRequirementInput,
  type CreateRoleAssignmentInput,
  type Member,
  type Organization,
  type Project,
  type Requirement,
  type RoleAssignment,
} from './types';

// Domain validation
export {
  assertAccountableIsHuman,
  assertSameOrganization,
  validateCreateMember,
  validateCreateOrganization,
  validateCreateProject,
  validateCreateRequirement,
  validateCreateRoleAssignment,
} from './validation';

export {
  RequirementStatus,
  WorkItemStatus,
  assertWorkItemTransition,
  deriveRequirementStatus,
  type GraphNodeState,
  type RequirementStatus as RequirementStatusValue,
  type WorkItemStatus as WorkItemStatusValue,
} from './work-graph';
