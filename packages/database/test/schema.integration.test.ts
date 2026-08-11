import { createDatabase, migrateDatabase, schema } from '@helm/database';
import { eq, and } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for database schema and invariants.
 *
 * REQUIRES: A running PostgreSQL instance.
 * Set DATABASE_URL environment variable, or use the default:
 *   postgres://helm:helm@localhost:5432/helm
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://helm:helm@localhost:5432/helm';

const db = createDatabase(DATABASE_URL, { maxConnections: 2 });
const { database } = db;

/** Safe unwrap for one-row results under noUncheckedIndexedAccess. */
function expectOne<T>(rows: T[], label: string): NonNullable<T> {
  const row = rows[0];
  if (row === undefined) throw new Error('Expected ' + label + ' to exist');
  return row as NonNullable<T>;
}

beforeAll(async () => {
  await migrateDatabase(database);
});

afterAll(async () => {
  await db.close();
});

// ─── Schema existence ────────────────────────────────────────────────────────

describe('Schema tables', () => {
  it('creates organizations table', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Test Org', slug: 'test-org-schema' })
      .returning();

    const row = expectOne([org], 'org');
    expect(row.id).toBeDefined();
    expect(row.slug).toBe('test-org-schema');

    await database
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, row.id));
  });

  it('creates members table with member_type enum', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'M Org', slug: 'm-org-schema' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [human] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Alice',
        email: 'alice@test.com',
      })
      .returning();
    expect(expectOne([human], 'human').memberType).toBe('human');

    const [agent] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'agent',
        name: 'Bot',
      })
      .returning();
    expect(expectOne([agent], 'agent').memberType).toBe('agent');

    await database.delete(schema.members).where(eq(schema.members.organizationId, orgRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });

  it('enforces unique slug on organizations', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Unique Org', slug: 'unique-org-schema' })
      .returning();
    const orgRow = expectOne([org], 'org');

    await expect(
      database
        .insert(schema.organizations)
        .values({ name: 'Duplicate', slug: 'unique-org-schema' }),
    ).rejects.toThrow();

    await database
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgRow.id));
  });

  it('enforces unique member-org-role on role_assignments (allows multiple roles per member)', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'RA Org', slug: 'ra-org-schema-multi' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [member] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Role User',
      })
      .returning();
    const memberRow = expectOne([member], 'member');

    // First role assignment should succeed
    await database
      .insert(schema.roleAssignments)
      .values({
        organizationId: orgRow.id,
        memberId: memberRow.id,
        role: 'admin',
      });

    // Same member, same org, different role should succeed (new behavior)
    await database
      .insert(schema.roleAssignments)
      .values({
        organizationId: orgRow.id,
        memberId: memberRow.id,
        role: 'viewer',
      });

    // Same member, same org, same role should fail (duplicate)
    await expect(
      database.insert(schema.roleAssignments).values({
        organizationId: orgRow.id,
        memberId: memberRow.id,
        role: 'admin',
      }),
    ).rejects.toThrow();

    await database.delete(schema.roleAssignments).where(eq(schema.roleAssignments.memberId, memberRow.id));
    await database.delete(schema.members).where(eq(schema.members.id, memberRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });

  it('enforces unique organization-slug pair on projects', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Proj Org', slug: 'proj-org-schema' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [human] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Owner',
      })
      .returning();
    const humanRow = expectOne([human], 'human');

    await database
      .insert(schema.projects)
      .values({
        organizationId: orgRow.id,
        name: 'Proj A',
        slug: 'proj-a',
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
      });

    await expect(
      database.insert(schema.projects).values({
        organizationId: orgRow.id,
        name: 'Proj A Duplicate',
        slug: 'proj-a',
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
      }),
    ).rejects.toThrow();

    await database.delete(schema.projects).where(eq(schema.projects.organizationId, orgRow.id));
    await database.delete(schema.members).where(eq(schema.members.id, humanRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });
});

// ─── Invariant enforcement ───────────────────────────────────────────────────

describe('Domain invariants', () => {
  it('rejects cross-organization references at database level (trigger-enforced)', async () => {
    const [org1] = await database
      .insert(schema.organizations)
      .values({ name: 'Org One', slug: 'inv-org-one' })
      .returning();
    const org1Row = expectOne([org1], 'org1');

    const [org2] = await database
      .insert(schema.organizations)
      .values({ name: 'Org Two', slug: 'inv-org-two' })
      .returning();
    const org2Row = expectOne([org2], 'org2');

    const [humanInOrg2] = await database
      .insert(schema.members)
      .values({
        organizationId: org2Row.id,
        memberType: 'human',
        name: 'Cross Human',
      })
      .returning();
    const crossHuman = expectOne([humanInOrg2], 'humanInOrg2');

    const [humanInOrg1] = await database
      .insert(schema.members)
      .values({
        organizationId: org1Row.id,
        memberType: 'human',
        name: 'Org1 Human',
      })
      .returning();
    const org1Human = expectOne([humanInOrg1], 'humanInOrg1');

    // Attempt to create project in org1 with accountableHumanId from org2
    await expect(
      database.insert(schema.projects).values({
        organizationId: org1Row.id,
        name: 'Cross Org Project',
        slug: 'cross-org',
        accountableHumanId: crossHuman.id,
        operationalOwnerId: org1Human.id,
      }),
    ).rejects.toThrow();

    // Attempt with agent as accountable human
    const [agentInOrg1] = await database
      .insert(schema.members)
      .values({
        organizationId: org1Row.id,
        memberType: 'agent',
        name: 'AgentBot',
      })
      .returning();
    const agentRow = expectOne([agentInOrg1], 'agentInOrg1');

    await expect(
      database.insert(schema.projects).values({
        organizationId: org1Row.id,
        name: 'Agent-Led Project',
        slug: 'agent-led',
        accountableHumanId: agentRow.id,
        operationalOwnerId: org1Human.id,
      }),
    ).rejects.toThrow();

    await database.delete(schema.members).where(eq(schema.members.organizationId, org1Row.id));
    await database.delete(schema.members).where(eq(schema.members.organizationId, org2Row.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, org1Row.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, org2Row.id));
  });

  it('allows Agent and Service members (non-human types)', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Multi-Type Org', slug: 'multi-type-org' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [agent] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'agent',
        name: 'HelperBot',
      })
      .returning();

    const [service] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'service',
        name: 'GitHub CI',
      })
      .returning();

    expect(expectOne([agent], 'agent').memberType).toBe('agent');
    expect(expectOne([service], 'service').memberType).toBe('service');

    await database.delete(schema.members).where(eq(schema.members.organizationId, orgRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });

  it('stores and retrieves acceptance criteria as JSON array', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Req Org', slug: 'req-org-ac' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [human] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Req Author',
      })
      .returning();
    const humanRow = expectOne([human], 'human');

    const [project] = await database
      .insert(schema.projects)
      .values({
        organizationId: orgRow.id,
        name: 'Req Project',
        slug: 'req-project-ac',
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
      })
      .returning();
    const projRow = expectOne([project], 'project');

    const criteria = [
      'User can log in',
      'Invalid credentials show error',
      'Password reset flow works',
    ];

    const [req] = await database
      .insert(schema.requirements)
      .values({
        projectId: projRow.id,
        goal: 'Implement authentication',
        acceptanceCriteria: criteria,
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
        assigneeMemberId: humanRow.id,
      })
      .returning();
    const reqRow = expectOne([req], 'req');

    expect(reqRow.goal).toBe('Implement authentication');
    expect(Array.isArray(reqRow.acceptanceCriteria)).toBe(true);
    expect(reqRow.acceptanceCriteria).toHaveLength(3);
    expect(reqRow.acceptanceCriteria).toEqual(criteria);

    await database.delete(schema.requirements).where(eq(schema.requirements.projectId, projRow.id));
    await database.delete(schema.projects).where(eq(schema.projects.id, projRow.id));
    await database.delete(schema.members).where(eq(schema.members.id, humanRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });

  it('rejects blank goals and malformed acceptance criteria at database level', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Validation Org', slug: 'validation-org' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [human] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Validation Owner',
      })
      .returning();
    const humanRow = expectOne([human], 'human');

    const [project] = await database
      .insert(schema.projects)
      .values({
        organizationId: orgRow.id,
        name: 'Validation Project',
        slug: 'validation-project',
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
      })
      .returning();
    const projectRow = expectOne([project], 'project');
    const responsibility = {
      projectId: projectRow.id,
      accountableHumanId: humanRow.id,
      operationalOwnerId: humanRow.id,
      assigneeMemberId: humanRow.id,
    };

    await expect(
      database.insert(schema.requirements).values({
        ...responsibility,
        goal: '   ',
        acceptanceCriteria: ['Valid criterion'],
      }),
    ).rejects.toThrow();

    await expect(
      database.insert(schema.requirements).values({
        ...responsibility,
        goal: 'Valid goal',
        acceptanceCriteria: ['   '],
      }),
    ).rejects.toThrow();

    await expect(
      database.insert(schema.requirements).values({
        ...responsibility,
        goal: 'Valid goal',
        acceptanceCriteria: [42],
      }),
    ).rejects.toThrow();

    await database.delete(schema.projects).where(eq(schema.projects.id, projectRow.id));
    await database.delete(schema.members).where(eq(schema.members.id, humanRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });

  it('cascade-deletes members when organization is deleted', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Cascade Org', slug: 'cascade-org' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [member] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Cascade User',
      })
      .returning();
    const memberRow = expectOne([member], 'member');

    await database
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgRow.id));

    const remaining = await database
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberRow.id));

    expect(remaining).toHaveLength(0);
  });

  it('restricts deletion of member referenced as accountable human', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Restrict Org', slug: 'restrict-org' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [human] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Accountable',
      })
      .returning();
    const humanRow = expectOne([human], 'human');

    await database
      .insert(schema.projects)
      .values({
        organizationId: orgRow.id,
        name: 'Pinned Project',
        slug: 'pinned',
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
      });

    await expect(
      database.delete(schema.members).where(eq(schema.members.id, humanRow.id)),
    ).rejects.toThrow();

    await database.delete(schema.projects).where(eq(schema.projects.organizationId, orgRow.id));
    await database.delete(schema.members).where(eq(schema.members.id, humanRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });
});

// ─── Query patterns ──────────────────────────────────────────────────────────

describe('Query patterns', () => {
  it('queries members by organization', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Query Org', slug: 'query-org' })
      .returning();
    const orgRow = expectOne([org], 'org');

    await database.insert(schema.members).values([
      { organizationId: orgRow.id, memberType: 'human', name: 'Alice' },
      { organizationId: orgRow.id, memberType: 'agent', name: 'Bot' },
      { organizationId: orgRow.id, memberType: 'service', name: 'CI' },
    ]);

    const members = await database
      .select()
      .from(schema.members)
      .where(eq(schema.members.organizationId, orgRow.id));

    expect(members).toHaveLength(3);

    await database.delete(schema.members).where(eq(schema.members.organizationId, orgRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });

  it('queries requirements by project', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'Req Query Org', slug: 'req-query-org' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [human] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Author',
      })
      .returning();
    const humanRow = expectOne([human], 'human');

    const [project] = await database
      .insert(schema.projects)
      .values({
        organizationId: orgRow.id,
        name: 'Query Project',
        slug: 'query-proj',
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
      })
      .returning();
    const projRow = expectOne([project], 'project');

    await database.insert(schema.requirements).values([
      {
        projectId: projRow.id,
        goal: 'Req 1',
        acceptanceCriteria: ['Works'],
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
        assigneeMemberId: humanRow.id,
      },
      {
        projectId: projRow.id,
        goal: 'Req 2',
        acceptanceCriteria: ['Also works'],
        accountableHumanId: humanRow.id,
        operationalOwnerId: humanRow.id,
        assigneeMemberId: humanRow.id,
      },
    ]);

    const reqs = await database
      .select()
      .from(schema.requirements)
      .where(eq(schema.requirements.projectId, projRow.id));

    expect(reqs).toHaveLength(2);

    await database.delete(schema.requirements).where(eq(schema.requirements.projectId, projRow.id));
    await database.delete(schema.projects).where(eq(schema.projects.id, projRow.id));
    await database.delete(schema.members).where(eq(schema.members.id, humanRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });

  it('rejects cross-organization assignee for requirements at DB level', async () => {
    const [org1] = await database
      .insert(schema.organizations)
      .values({ name: 'Req Org 1', slug: 'req-org-1' })
      .returning();
    const org1Row = expectOne([org1], 'org1');

    const [org2] = await database
      .insert(schema.organizations)
      .values({ name: 'Req Org 2', slug: 'req-org-2' })
      .returning();
    const org2Row = expectOne([org2], 'org2');

    const [human1] = await database
      .insert(schema.members)
      .values({
        organizationId: org1Row.id,
        memberType: 'human',
        name: 'Human Org1',
      })
      .returning();
    const human1Row = expectOne([human1], 'human1');

    const [human2] = await database
      .insert(schema.members)
      .values({
        organizationId: org2Row.id,
        memberType: 'human',
        name: 'Human Org2',
      })
      .returning();
    const human2Row = expectOne([human2], 'human2');

    const [project] = await database
      .insert(schema.projects)
      .values({
        organizationId: org1Row.id,
        name: 'Test Project',
        slug: 'test-proj-co',
        accountableHumanId: human1Row.id,
        operationalOwnerId: human1Row.id,
      })
      .returning();
    const projRow = expectOne([project], 'project');

    // Attempt to assign a member from org2 to a requirement in org1's project
    await expect(
      database.insert(schema.requirements).values({
        projectId: projRow.id,
        goal: 'Cross-org assignment test',
        acceptanceCriteria: ['Should fail'],
        accountableHumanId: human1Row.id,
        operationalOwnerId: human1Row.id,
        assigneeMemberId: human2Row.id,
      }),
    ).rejects.toThrow();

    await database.delete(schema.requirements).where(eq(schema.requirements.projectId, projRow.id));
    await database.delete(schema.projects).where(eq(schema.projects.id, projRow.id));
    await database.delete(schema.members).where(eq(schema.members.organizationId, org1Row.id));
    await database.delete(schema.members).where(eq(schema.members.organizationId, org2Row.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, org1Row.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, org2Row.id));
  });

  it('queries role assignments by member and organization', async () => {
    const [org] = await database
      .insert(schema.organizations)
      .values({ name: 'RA Query Org', slug: 'ra-query-org' })
      .returning();
    const orgRow = expectOne([org], 'org');

    const [member] = await database
      .insert(schema.members)
      .values({
        organizationId: orgRow.id,
        memberType: 'human',
        name: 'Role User',
      })
      .returning();
    const memberRow = expectOne([member], 'member');

    await database.insert(schema.roleAssignments).values({
      organizationId: orgRow.id,
      memberId: memberRow.id,
      role: 'admin',
    });

    const assignments = await database
      .select()
      .from(schema.roleAssignments)
      .where(
        and(
          eq(schema.roleAssignments.memberId, memberRow.id),
          eq(schema.roleAssignments.organizationId, orgRow.id),
        ),
      );

    expect(assignments).toHaveLength(1);
    expect(expectOne(assignments, 'assignment').role).toBe('admin');

    await database.delete(schema.roleAssignments).where(eq(schema.roleAssignments.memberId, memberRow.id));
    await database.delete(schema.members).where(eq(schema.members.id, memberRow.id));
    await database.delete(schema.organizations).where(eq(schema.organizations.id, orgRow.id));
  });
});
