import {
  AccountableHumanRequiredError,
  CrossOrganizationError,
  NonEmptyFieldRequiredError,
  ValidationError,
} from './errors';
import {
  type CreateMemberInput,
  type CreateOrganizationInput,
  type CreateProjectInput,
  type CreateRequirementInput,
  type CreateRoleAssignmentInput,
  type Member,
  MemberType,
} from './types';

/**
 * Pure validation functions that enforce domain invariants.
 * All functions throw a DomainError subclass on violation.
 */

export function validateCreateOrganization(
  input: CreateOrganizationInput,
): void {
  if (!input.name.trim()) {
    throw new NonEmptyFieldRequiredError('name');
  }
  if (!input.slug.trim()) {
    throw new NonEmptyFieldRequiredError('slug');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new ValidationError(
      'slug must be lowercase alphanumeric with hyphens',
    );
  }
}

export function validateCreateMember(input: CreateMemberInput): void {
  if (!input.name.trim()) {
    throw new NonEmptyFieldRequiredError('name');
  }
  if (!Object.values(MemberType).includes(input.memberType)) {
    throw new ValidationError(
      `memberType must be one of: ${Object.values(MemberType).join(', ')}`,
    );
  }
  if (input.email !== undefined && input.email !== null) {
    if (!input.email.includes('@')) {
      throw new ValidationError('email must be a valid email address');
    }
  }
}

export function validateCreateRoleAssignment(
  input: CreateRoleAssignmentInput,
): void {
  if (!input.memberId) {
    throw new NonEmptyFieldRequiredError('memberId');
  }
  if (!input.role) {
    throw new NonEmptyFieldRequiredError('role');
  }
}

export function validateCreateProject(input: CreateProjectInput): void {
  if (!input.name.trim()) {
    throw new NonEmptyFieldRequiredError('name');
  }
  if (!input.slug.trim()) {
    throw new NonEmptyFieldRequiredError('slug');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    throw new ValidationError(
      'slug must be lowercase alphanumeric with hyphens',
    );
  }
  if (!input.accountableHumanId) {
    throw new NonEmptyFieldRequiredError('accountableHumanId');
  }
  if (!input.operationalOwnerId) {
    throw new NonEmptyFieldRequiredError('operationalOwnerId');
  }
}

export function validateCreateRequirement(
  input: CreateRequirementInput,
): void {
  if (!input.goal.trim()) {
    throw new NonEmptyFieldRequiredError('goal');
  }
  if (
    !Array.isArray(input.acceptanceCriteria) ||
    input.acceptanceCriteria.length === 0
  ) {
    throw new NonEmptyFieldRequiredError('acceptanceCriteria');
  }
  for (const [index, criterion] of input.acceptanceCriteria.entries()) {
    if (typeof criterion !== 'string' || !criterion.trim()) {
      throw new ValidationError(
        `acceptanceCriteria[${index}] must be a non-empty string`,
      );
    }
  }
  if (!input.accountableHumanId) {
    throw new NonEmptyFieldRequiredError('accountableHumanId');
  }
  if (!input.operationalOwnerId) {
    throw new NonEmptyFieldRequiredError('operationalOwnerId');
  }
  if (!input.assigneeMemberId) {
    throw new NonEmptyFieldRequiredError('assigneeMemberId');
  }
}

/**
 * Enforce that accountable human is actually a Human member.
 * Called with the accountable member row to validate it.
 */
export function assertAccountableIsHuman(
  accountableMember: Member,
  organizationId: string,
): void {
  if (accountableMember.memberType !== MemberType.Human) {
    throw new AccountableHumanRequiredError();
  }
  if (accountableMember.organizationId !== organizationId) {
    throw new CrossOrganizationError('accountableHumanId');
  }
}

/**
 * Enforce that a referenced member belongs to the same organization.
 */
export function assertSameOrganization(
  member: Member,
  expectedOrganizationId: string,
  field: string,
): void {
  if (member.organizationId !== expectedOrganizationId) {
    throw new CrossOrganizationError(field);
  }
}
