import {
  BugNotFoundError,
  BugValidationError,
  BugVersionConflictError,
  DuplicateBugRecordError,
  InvalidBugTransitionError,
  InvalidQaRegressionTransitionError,
  QaRegressionNotFoundError,
  QaRegressionVersionConflictError,
} from "./errors.ts";
import type { BugFixEdge, BugWorkItem, QaRegressionEdge } from "./types.ts";

export interface BugRepository {
  insertBug(bug: BugWorkItem): Promise<void>;
  saveBug(bug: BugWorkItem, expectedVersion: number): Promise<void>;
  submitFixForQa(
    bug: BugWorkItem,
    fix: BugFixEdge,
    regression: QaRegressionEdge,
    expectedBugVersion: number,
  ): Promise<void>;
  completeRegression(
    bug: BugWorkItem,
    regression: QaRegressionEdge,
    expectedBugVersion: number,
    expectedRegressionVersion: number,
  ): Promise<void>;
  findBug(bugId: string): Promise<BugWorkItem | undefined>;
  findRegression(regressionId: string): Promise<QaRegressionEdge | undefined>;
  listBugsForRequirement(requirementId: string): Promise<readonly BugWorkItem[]>;
  listFixesForBug(bugId: string): Promise<readonly BugFixEdge[]>;
  listRegressionsForBug(bugId: string): Promise<readonly QaRegressionEdge[]>;
  listBlockingBugsForRequirement(
    requirementId: string,
  ): Promise<readonly BugWorkItem[]>;
}

function sameBugIdentity(left: BugWorkItem, right: BugWorkItem): boolean {
  return (
    left.id === right.id &&
    left.sourceRequirementId === right.sourceRequirementId &&
    left.graphVersion === right.graphVersion &&
    left.title === right.title &&
    left.description === right.description &&
    left.discoveredIn === right.discoveredIn &&
    left.severity === right.severity &&
    left.reporterMemberId === right.reporterMemberId &&
    left.createdAt === right.createdAt
  );
}

export class InMemoryBugRepository implements BugRepository {
  readonly #bugs = new Map<string, BugWorkItem>();
  readonly #fixes = new Map<string, BugFixEdge>();
  readonly #fixIdByResultId = new Map<string, string>();
  readonly #regressions = new Map<string, QaRegressionEdge>();
  readonly #regressionIdByFixId = new Map<string, string>();

  async insertBug(bug: BugWorkItem): Promise<void> {
    if (this.#bugs.has(bug.id)) throw new DuplicateBugRecordError(bug.id);
    if (bug.status !== "open" || bug.version !== 1) {
      throw new BugValidationError("A new Bug must be open at version 1");
    }
    this.#bugs.set(bug.id, bug);
  }

  async saveBug(bug: BugWorkItem, expectedVersion: number): Promise<void> {
    const current = this.#bugs.get(bug.id);
    if (!current) throw new BugNotFoundError(bug.id);
    this.#assertBugUpdate(current, bug, expectedVersion);
    if (current.status !== "open" || bug.status !== "fix_in_progress") {
      throw new InvalidBugTransitionError(current.status, bug.status);
    }
    this.#bugs.set(bug.id, bug);
  }

  async submitFixForQa(
    bug: BugWorkItem,
    fix: BugFixEdge,
    regression: QaRegressionEdge,
    expectedBugVersion: number,
  ): Promise<void> {
    const current = this.#bugs.get(bug.id);
    if (!current) throw new BugNotFoundError(bug.id);
    this.#assertBugUpdate(current, bug, expectedBugVersion);
    if (current.status !== "fix_in_progress" || bug.status !== "awaiting_qa") {
      throw new InvalidBugTransitionError(current.status, bug.status);
    }
    if (
      fix.bugId !== bug.id ||
      regression.bugId !== bug.id ||
      regression.fixEdgeId !== fix.id ||
      regression.status !== "pending" ||
      regression.version !== 1
    ) {
      throw new BugValidationError("Fix and QA regression edges do not match the Bug");
    }
    if (this.#fixes.has(fix.id) || this.#fixIdByResultId.has(fix.resultId)) {
      throw new DuplicateBugRecordError(fix.id);
    }
    if (
      this.#regressions.has(regression.id) ||
      this.#regressionIdByFixId.has(fix.id)
    ) {
      throw new DuplicateBugRecordError(regression.id);
    }

    this.#bugs.set(bug.id, bug);
    this.#fixes.set(fix.id, fix);
    this.#fixIdByResultId.set(fix.resultId, fix.id);
    this.#regressions.set(regression.id, regression);
    this.#regressionIdByFixId.set(fix.id, regression.id);
  }

  async completeRegression(
    bug: BugWorkItem,
    regression: QaRegressionEdge,
    expectedBugVersion: number,
    expectedRegressionVersion: number,
  ): Promise<void> {
    const currentBug = this.#bugs.get(bug.id);
    if (!currentBug) throw new BugNotFoundError(bug.id);
    const currentRegression = this.#regressions.get(regression.id);
    if (!currentRegression) throw new QaRegressionNotFoundError(regression.id);
    this.#assertBugUpdate(currentBug, bug, expectedBugVersion);
    if (currentRegression.version !== expectedRegressionVersion) {
      throw new QaRegressionVersionConflictError(
        regression.id,
        expectedRegressionVersion,
        currentRegression.version,
      );
    }
    if (currentRegression.status !== "pending") {
      throw new InvalidQaRegressionTransitionError(
        currentRegression.status,
        regression.status,
      );
    }
    if (
      regression.version !== expectedRegressionVersion + 1 ||
      regression.bugId !== currentRegression.bugId ||
      regression.fixEdgeId !== currentRegression.fixEdgeId ||
      regression.qaMemberId !== currentRegression.qaMemberId ||
      regression.requestedAt !== currentRegression.requestedAt ||
      regression.completedAt === null
    ) {
      throw new BugValidationError("QA regression identity or version is invalid");
    }
    const passed = regression.status === "passed";
    if (
      currentBug.status !== "awaiting_qa" ||
      bug.status !== (passed ? "closed" : "open") ||
      (passed && (bug.blocking || bug.closedAt === null)) ||
      (!passed && bug.closedAt !== null)
    ) {
      throw new BugValidationError("Bug state disagrees with QA regression outcome");
    }
    this.#bugs.set(bug.id, bug);
    this.#regressions.set(regression.id, regression);
  }

  async findBug(bugId: string): Promise<BugWorkItem | undefined> {
    return this.#bugs.get(bugId);
  }

  async findRegression(
    regressionId: string,
  ): Promise<QaRegressionEdge | undefined> {
    return this.#regressions.get(regressionId);
  }

  async listBugsForRequirement(
    requirementId: string,
  ): Promise<readonly BugWorkItem[]> {
    return Object.freeze(
      [...this.#bugs.values()]
        .filter((bug) => bug.sourceRequirementId === requirementId)
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  async listFixesForBug(bugId: string): Promise<readonly BugFixEdge[]> {
    return Object.freeze(
      [...this.#fixes.values()]
        .filter((fix) => fix.bugId === bugId)
        .sort(
          (left, right) =>
            left.fixedAt.localeCompare(right.fixedAt) || left.id.localeCompare(right.id),
        ),
    );
  }

  async listRegressionsForBug(
    bugId: string,
  ): Promise<readonly QaRegressionEdge[]> {
    return Object.freeze(
      [...this.#regressions.values()]
        .filter((regression) => regression.bugId === bugId)
        .sort(
          (left, right) =>
            left.requestedAt.localeCompare(right.requestedAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  async listBlockingBugsForRequirement(
    requirementId: string,
  ): Promise<readonly BugWorkItem[]> {
    return Object.freeze(
      (await this.listBugsForRequirement(requirementId)).filter(
        (bug) => bug.blocking && bug.status !== "closed",
      ),
    );
  }

  #assertBugUpdate(
    current: BugWorkItem,
    next: BugWorkItem,
    expectedVersion: number,
  ): void {
    if (current.version !== expectedVersion) {
      throw new BugVersionConflictError(
        current.id,
        expectedVersion,
        current.version,
      );
    }
    if (next.version !== expectedVersion + 1) {
      throw new BugValidationError("Bug version must increment exactly once");
    }
    if (!sameBugIdentity(current, next)) {
      throw new BugValidationError("Bug identity and source fields are immutable");
    }
  }
}
