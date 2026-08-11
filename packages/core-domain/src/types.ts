/**
 * Core domain types for HELM.
 *
 * These are pure TypeScript types representing the domain entities.
 * They are independent of any persistence or transport layer.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export const MemberType = {
  Human: 'human',
  Agent: 'agent',
  Service: 'service',
} as const;

export type MemberType = (typeof MemberType)[keyof typeof MemberType];

export const RoleType = {
  Owner: 'owner',
  Admin: 'admin',
  Member: 'member',
  Viewer: 'viewer',
} as const;

export type RoleType = (typeof RoleType)[keyof typeof RoleType];

// ─── Entities ────────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Member {
  id: string;
  organizationId: string;
  memberType: MemberType;
  name: string;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleAssignment {
  id: string;
  organizationId: string;
  memberId: string;
  role: RoleType;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  /** Must always resolve to a Human member in the same organization. */
  accountableHumanId: string;
  /** Must belong to the same organization. */
  operationalOwnerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Requirement {
  id: string;
  projectId: string;
  goal: string;
  /** Non-empty array of acceptance criterion strings. */
  acceptanceCriteria: string[];
  /** Must always resolve to a Human member in the same organization as the parent project. */
  accountableHumanId: string;
  /** Must belong to the same organization as the parent project. */
  operationalOwnerId: string;
  /** Must belong to the same organization as the parent project. */
  assigneeMemberId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

export interface CreateMemberInput {
  organizationId: string;
  memberType: MemberType;
  name: string;
  email?: string | null;
}

export interface CreateRoleAssignmentInput {
  organizationId: string;
  memberId: string;
  role: RoleType;
}

export interface CreateProjectInput {
  organizationId: string;
  name: string;
  slug: string;
  description?: string | null;
  accountableHumanId: string;
  operationalOwnerId: string;
}

export interface CreateRequirementInput {
  projectId: string;
  goal: string;
  acceptanceCriteria: string[];
  accountableHumanId: string;
  operationalOwnerId: string;
  assigneeMemberId: string;
}
