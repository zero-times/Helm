import type {
  ExecutionRepository,
  ManualExecution,
} from "../../execution/src/index.ts";
import {
  DuplicateReviewError,
  GateNotFoundError,
  GateVersionConflictError,
  InvalidGateTransitionError,
  InvalidReviewTransitionError,
  InvalidReworkTransitionError,
  ReviewNotFoundError,
  ReviewValidationError,
  ReviewVersionConflictError,
  ReworkNotFoundError,
  ReworkVersionConflictError,
} from "./errors.ts";
import type { HumanGate, Review, ReworkRequest } from "./types.ts";

export interface ReviewRepository {
  insertPending(review: Review, gate: HumanGate): Promise<void>;
  decide(
    review: Review,
    gate: HumanGate,
    rework: ReworkRequest | undefined,
    expectedReviewVersion: number,
    expectedGateVersion: number,
  ): Promise<void>;
  startRework(
    rework: ReworkRequest,
    execution: ManualExecution,
    expectedVersion: number,
  ): Promise<void>;
  findReview(reviewId: string): Promise<Review | undefined>;
  findGate(gateId: string): Promise<HumanGate | undefined>;
  findGateByReviewId(reviewId: string): Promise<HumanGate | undefined>;
  findRework(reworkId: string): Promise<ReworkRequest | undefined>;
  listReviewsForWorkItem(workItemId: string): Promise<readonly Review[]>;
  listGatesForWorkItem(workItemId: string): Promise<readonly HumanGate[]>;
  listReworksForWorkItem(workItemId: string): Promise<readonly ReworkRequest[]>;
}

function reviewIdentity(review: Review): string {
  return [
    review.id,
    review.resultId,
    review.executionId,
    review.workItemId,
    review.graphVersion,
    review.reviewerMemberId,
    review.requestedAt,
  ].join("\u0000");
}

function gateIdentity(gate: HumanGate): string {
  return [
    gate.id,
    gate.reviewId,
    gate.workItemId,
    gate.graphVersion,
    gate.openedAt,
  ].join("\u0000");
}

/**
 * Deterministic repository for domain tests and isolated consumers.
 * The production adapter must perform each mutating method in one database
 * transaction. In particular, startRework inserts the new Execution and links
 * the Rework request as one operation.
 */
export class InMemoryReviewRepository implements ReviewRepository {
  readonly #executionRepository: ExecutionRepository;
  readonly #reviews = new Map<string, Review>();
  readonly #reviewIdByResultId = new Map<string, string>();
  readonly #gates = new Map<string, HumanGate>();
  readonly #gateIdByReviewId = new Map<string, string>();
  readonly #reworks = new Map<string, ReworkRequest>();
  readonly #reworkIdByReviewId = new Map<string, string>();
  readonly #reworkIdByNewExecutionId = new Map<string, string>();

  constructor(executionRepository: ExecutionRepository) {
    this.#executionRepository = executionRepository;
  }

  async insertPending(review: Review, gate: HumanGate): Promise<void> {
    if (review.status !== "pending" || gate.status !== "pending") {
      throw new ReviewValidationError("A new Review and Human gate must be pending");
    }
    if (
      gate.reviewId !== review.id ||
      gate.workItemId !== review.workItemId ||
      gate.graphVersion !== review.graphVersion
    ) {
      throw new ReviewValidationError("Human gate does not match its Review");
    }
    if (
      this.#reviews.has(review.id) ||
      this.#reviewIdByResultId.has(review.resultId)
    ) {
      throw new DuplicateReviewError(review.resultId);
    }
    if (this.#gates.has(gate.id) || this.#gateIdByReviewId.has(review.id)) {
      throw new DuplicateReviewError(gate.id);
    }
    this.#reviews.set(review.id, review);
    this.#reviewIdByResultId.set(review.resultId, review.id);
    this.#gates.set(gate.id, gate);
    this.#gateIdByReviewId.set(review.id, gate.id);
  }

  async decide(
    review: Review,
    gate: HumanGate,
    rework: ReworkRequest | undefined,
    expectedReviewVersion: number,
    expectedGateVersion: number,
  ): Promise<void> {
    const currentReview = this.#reviews.get(review.id);
    if (!currentReview) throw new ReviewNotFoundError(review.id);
    const currentGate = this.#gates.get(gate.id);
    if (!currentGate) throw new GateNotFoundError(gate.id);
    if (currentReview.version !== expectedReviewVersion) {
      throw new ReviewVersionConflictError(
        review.id,
        expectedReviewVersion,
        currentReview.version,
      );
    }
    if (currentGate.version !== expectedGateVersion) {
      throw new GateVersionConflictError(
        gate.id,
        expectedGateVersion,
        currentGate.version,
      );
    }
    if (currentReview.status !== "pending") {
      throw new InvalidReviewTransitionError(currentReview.status, review.status);
    }
    if (currentGate.status !== "pending") {
      throw new InvalidGateTransitionError(currentGate.status, gate.status);
    }
    if (
      reviewIdentity(currentReview) !== reviewIdentity(review) ||
      gateIdentity(currentGate) !== gateIdentity(gate)
    ) {
      throw new ReviewValidationError("Review and Human gate identity is immutable");
    }
    if (
      review.version !== expectedReviewVersion + 1 ||
      gate.version !== expectedGateVersion + 1
    ) {
      throw new ReviewValidationError("Decision versions must increment exactly once");
    }
    const isApproved = review.status === "approved" && gate.status === "passed";
    const isRejected =
      review.status === "rejected" && gate.status === "rework_required";
    if (!isApproved && !isRejected) {
      throw new ReviewValidationError("Review decision and Human gate disagree");
    }
    if ((isApproved && rework) || (isRejected && !rework)) {
      throw new ReviewValidationError(
        "Rejected Reviews require one Rework request; approved Reviews forbid it",
      );
    }
    if (rework) {
      if (
        rework.rejectedReviewId !== review.id ||
        rework.previousExecutionId !== review.executionId ||
        rework.previousResultId !== review.resultId ||
        rework.workItemId !== review.workItemId ||
        rework.graphVersion !== review.graphVersion
      ) {
        throw new ReviewValidationError("Rework request does not match the Review");
      }
      if (
        this.#reworks.has(rework.id) ||
        this.#reworkIdByReviewId.has(review.id)
      ) {
        throw new DuplicateReviewError(rework.id);
      }
    }

    // All validation completes before the in-memory transaction mutates state.
    this.#reviews.set(review.id, review);
    this.#gates.set(gate.id, gate);
    if (rework) {
      this.#reworks.set(rework.id, rework);
      this.#reworkIdByReviewId.set(review.id, rework.id);
    }
  }

  async startRework(
    rework: ReworkRequest,
    execution: ManualExecution,
    expectedVersion: number,
  ): Promise<void> {
    const current = this.#reworks.get(rework.id);
    if (!current) throw new ReworkNotFoundError(rework.id);
    if (current.version !== expectedVersion) {
      throw new ReworkVersionConflictError(
        rework.id,
        expectedVersion,
        current.version,
      );
    }
    if (current.status !== "requested" || rework.status !== "started") {
      throw new InvalidReworkTransitionError(current.status, rework.status);
    }
    if (
      rework.version !== expectedVersion + 1 ||
      rework.newExecutionId !== execution.id ||
      rework.workItemId !== execution.workItemId ||
      rework.graphVersion !== execution.graphVersion ||
      current.id !== rework.id ||
      current.rejectedReviewId !== rework.rejectedReviewId ||
      current.previousExecutionId !== rework.previousExecutionId ||
      current.previousResultId !== rework.previousResultId ||
      current.workItemId !== rework.workItemId ||
      current.graphVersion !== rework.graphVersion ||
      current.reason !== rework.reason ||
      current.requestedAt !== rework.requestedAt
    ) {
      throw new ReviewValidationError("Rework request identity is immutable");
    }
    if (this.#reworkIdByNewExecutionId.has(execution.id)) {
      throw new ReviewValidationError(
        `Execution ${execution.id} is already linked to another Rework request`,
      );
    }
    if (await this.#executionRepository.findExecution(execution.id)) {
      throw new ReviewValidationError(`Execution ${execution.id} already exists`);
    }

    // No map mutation below can fail after the Execution insert succeeds. The
    // SQL adapter provides the same guarantee with a database transaction.
    await this.#executionRepository.insertExecution(execution);
    this.#reworks.set(rework.id, rework);
    this.#reworkIdByNewExecutionId.set(execution.id, rework.id);
  }

  async findReview(reviewId: string): Promise<Review | undefined> {
    return this.#reviews.get(reviewId);
  }

  async findGate(gateId: string): Promise<HumanGate | undefined> {
    return this.#gates.get(gateId);
  }

  async findGateByReviewId(reviewId: string): Promise<HumanGate | undefined> {
    const gateId = this.#gateIdByReviewId.get(reviewId);
    return gateId ? this.#gates.get(gateId) : undefined;
  }

  async findRework(reworkId: string): Promise<ReworkRequest | undefined> {
    return this.#reworks.get(reworkId);
  }

  async listReviewsForWorkItem(workItemId: string): Promise<readonly Review[]> {
    return Object.freeze(
      [...this.#reviews.values()]
        .filter((review) => review.workItemId === workItemId)
        .sort(
          (left, right) =>
            left.requestedAt.localeCompare(right.requestedAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  async listGatesForWorkItem(workItemId: string): Promise<readonly HumanGate[]> {
    return Object.freeze(
      [...this.#gates.values()]
        .filter((gate) => gate.workItemId === workItemId)
        .sort(
          (left, right) =>
            left.openedAt.localeCompare(right.openedAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  async listReworksForWorkItem(
    workItemId: string,
  ): Promise<readonly ReworkRequest[]> {
    return Object.freeze(
      [...this.#reworks.values()]
        .filter((rework) => rework.workItemId === workItemId)
        .sort(
          (left, right) =>
            left.requestedAt.localeCompare(right.requestedAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }
}
