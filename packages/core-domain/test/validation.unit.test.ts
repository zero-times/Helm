import { describe, it, expect } from 'vitest';
import {
  AccountableHumanRequiredError,
  CrossOrganizationError,
  MemberType,
  NonEmptyFieldRequiredError,
  ValidationError,
  assertAccountableIsHuman,
  assertSameOrganization,
  validateCreateMember,
  validateCreateOrganization,
  validateCreateProject,
  validateCreateRequirement,
} from '../src/index';
import type { Member } from '../src/types';

// ─── Organization validation ─────────────────────────────────────────────────

describe('validateCreateOrganization', () => {
  it('accepts valid input', () => {
    expect(() =>
      validateCreateOrganization({ name: 'Acme Corp', slug: 'acme-corp' }),
    ).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      validateCreateOrganization({ name: '  ', slug: 'acme' }),
    ).toThrow(NonEmptyFieldRequiredError);
  });

  it('rejects empty slug', () => {
    expect(() =>
      validateCreateOrganization({ name: 'Acme', slug: '' }),
    ).toThrow(NonEmptyFieldRequiredError);
  });

  it('rejects invalid slug format', () => {
    expect(() =>
      validateCreateOrganization({ name: 'Acme', slug: 'ACME Corp!' }),
    ).toThrow(ValidationError);
  });
});

// ─── Member validation ───────────────────────────────────────────────────────

describe('validateCreateMember', () => {
  it('accepts valid human member', () => {
    expect(() =>
      validateCreateMember({
        organizationId: '00000000-0000-0000-0000-000000000001',
        memberType: MemberType.Human,
        name: 'Alice',
        email: 'alice@example.com',
      }),
    ).not.toThrow();
  });

  it('accepts valid agent member', () => {
    expect(() =>
      validateCreateMember({
        organizationId: '00000000-0000-0000-0000-000000000001',
        memberType: MemberType.Agent,
        name: 'CodeBot',
      }),
    ).not.toThrow();
  });

  it('accepts valid service member', () => {
    expect(() =>
      validateCreateMember({
        organizationId: '00000000-0000-0000-0000-000000000001',
        memberType: MemberType.Service,
        name: 'CI/CD Pipeline',
      }),
    ).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      validateCreateMember({
        organizationId: '00000000-0000-0000-0000-000000000001',
        memberType: MemberType.Human,
        name: '',
        email: 'a@b.com',
      }),
    ).toThrow(NonEmptyFieldRequiredError);
  });

  it('rejects invalid member type', () => {
    expect(() =>
      validateCreateMember({
        organizationId: '00000000-0000-0000-0000-000000000001',
        memberType: 'robot' as MemberType,
        name: 'X',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid email', () => {
    expect(() =>
      validateCreateMember({
        organizationId: '00000000-0000-0000-0000-000000000001',
        memberType: MemberType.Human,
        name: 'Bob',
        email: 'not-an-email',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts null email', () => {
    expect(() =>
      validateCreateMember({
        organizationId: '00000000-0000-0000-0000-000000000001',
        memberType: MemberType.Human,
        name: 'Bob',
        email: null,
      }),
    ).not.toThrow();
  });
});

// ─── Project validation ──────────────────────────────────────────────────────

describe('validateCreateProject', () => {
  it('accepts valid input', () => {
    expect(() =>
      validateCreateProject({
        organizationId: '00000000-0000-0000-0000-000000000001',
        name: 'My Project',
        slug: 'my-project',
        accountableHumanId: '00000000-0000-0000-0000-000000000002',
        operationalOwnerId: '00000000-0000-0000-0000-000000000003',
      }),
    ).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() =>
      validateCreateProject({
        organizationId: '00000000-0000-0000-0000-000000000001',
        name: '',
        slug: 'my-project',
        accountableHumanId: '00000000-0000-0000-0000-000000000002',
        operationalOwnerId: '00000000-0000-0000-0000-000000000003',
      }),
    ).toThrow(NonEmptyFieldRequiredError);
  });

  it('rejects empty accountableHumanId', () => {
    expect(() =>
      validateCreateProject({
        organizationId: '00000000-0000-0000-0000-000000000001',
        name: 'Project',
        slug: 'project',
        accountableHumanId: '',
        operationalOwnerId: '00000000-0000-0000-0000-000000000003',
      }),
    ).toThrow(NonEmptyFieldRequiredError);
  });
});

// ─── Requirement validation ──────────────────────────────────────────────────

describe('validateCreateRequirement', () => {
  it('accepts valid input', () => {
    expect(() =>
      validateCreateRequirement({
        projectId: '00000000-0000-0000-0000-000000000001',
        goal: 'Implement login',
        acceptanceCriteria: ['User can log in with email', 'Invalid credentials show error'],
        accountableHumanId: '00000000-0000-0000-0000-000000000002',
        operationalOwnerId: '00000000-0000-0000-0000-000000000003',
        assigneeMemberId: '00000000-0000-0000-0000-000000000004',
      }),
    ).not.toThrow();
  });

  it('rejects empty goal', () => {
    expect(() =>
      validateCreateRequirement({
        projectId: '00000000-0000-0000-0000-000000000001',
        goal: '  ',
        acceptanceCriteria: ['Must work'],
        accountableHumanId: '00000000-0000-0000-0000-000000000002',
        operationalOwnerId: '00000000-0000-0000-0000-000000000003',
        assigneeMemberId: '00000000-0000-0000-0000-000000000004',
      }),
    ).toThrow(NonEmptyFieldRequiredError);
  });

  it('rejects empty acceptance criteria array', () => {
    expect(() =>
      validateCreateRequirement({
        projectId: '00000000-0000-0000-0000-000000000001',
        goal: 'Implement login',
        acceptanceCriteria: [],
        accountableHumanId: '00000000-0000-0000-0000-000000000002',
        operationalOwnerId: '00000000-0000-0000-0000-000000000003',
        assigneeMemberId: '00000000-0000-0000-0000-000000000004',
      }),
    ).toThrow(NonEmptyFieldRequiredError);
  });

  it('rejects acceptance criteria with empty strings', () => {
    expect(() =>
      validateCreateRequirement({
        projectId: '00000000-0000-0000-0000-000000000001',
        goal: 'Implement login',
        acceptanceCriteria: ['Valid', ''],
        accountableHumanId: '00000000-0000-0000-0000-000000000002',
        operationalOwnerId: '00000000-0000-0000-0000-000000000003',
        assigneeMemberId: '00000000-0000-0000-0000-000000000004',
      }),
    ).toThrow(ValidationError);
  });
});

// ─── Accountability invariants ───────────────────────────────────────────────

describe('assertAccountableIsHuman', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  const humanMember: Member = {
    id: '00000000-0000-0000-0000-000000000002',
    organizationId: orgId,
    memberType: MemberType.Human,
    name: 'Alice',
    email: 'alice@example.com',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const agentMember: Member = {
    id: '00000000-0000-0000-0000-000000000003',
    organizationId: orgId,
    memberType: MemberType.Agent,
    name: 'CodeBot',
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts a Human member', () => {
    expect(() =>
      assertAccountableIsHuman(humanMember, orgId),
    ).not.toThrow();
  });

  it('rejects an Agent as accountable human', () => {
    expect(() =>
      assertAccountableIsHuman(agentMember, orgId),
    ).toThrow(AccountableHumanRequiredError);
  });

  it('rejects a member from a different organization', () => {
    const otherHuman: Member = {
      ...humanMember,
      organizationId: '00000000-0000-0000-0000-000000000999',
    };
    expect(() =>
      assertAccountableIsHuman(otherHuman, orgId),
    ).toThrow(CrossOrganizationError);
  });
});

// ─── Same-organization enforcement ───────────────────────────────────────────

describe('assertSameOrganization', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  const member: Member = {
    id: '00000000-0000-0000-0000-000000000002',
    organizationId: orgId,
    memberType: MemberType.Human,
    name: 'Alice',
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts member from same organization', () => {
    expect(() =>
      assertSameOrganization(member, orgId, 'testField'),
    ).not.toThrow();
  });

  it('rejects member from different organization', () => {
    expect(() =>
      assertSameOrganization(
        { ...member, organizationId: '00000000-0000-0000-0000-000000000999' },
        orgId,
        'testField',
      ),
    ).toThrow(CrossOrganizationError);
  });
});
