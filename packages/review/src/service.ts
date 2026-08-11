import {
  ExecutionNotFoundError,
  startManualExecution,
  type ExecutionRepository,
  type ManualExecutionStartGuard,
} from "../../execution/src/index.ts";
import {
  GateNotFoundError,
  ResultNotFoundError,
  ReviewNotFoundError,
  ReworkNotFoundError,
} from "./errors.ts";
import type { ReviewRepository } from "./repository.ts";
import {
  approveReview,
  createPendingReview,
  createReworkRequest,
  rejectReview,
  resolveGate,
  startReworkRequest,
} from "./review.ts";
import type {
  ApproveReviewInput,
  HumanGate,
  RejectReviewInput,
  RequestReviewInput,
  Review,
  ReworkRequest,
  StartedRework,
  StartReworkInput,
} from "./types.ts";

export class ReviewWorkflowService {
  readonly reviewRepository: ReviewRepository;
  readonly executionRepository: ExecutionRepository;
  readonly reworkStartGuard: ManualExecutionStartGuard;

  constructor(
    reviewRepository: ReviewRepository,
    executionRepository: ExecutionRepository,
    reworkStartGuard: ManualExecutionStartGuard,
  ) {
    this.reviewRepository = reviewRepository;
    this.executionRepository = executionRepository;
    this.reworkStartGuard = reworkStartGuard;
  }

  async requestReview(
    input: RequestReviewInput,
  ): Promise<{ review: Review; gate: HumanGate }> {
    const execution = await this.executionRepository.findExecution(
      input.executionId,
    );
    if (!execution) throw new ExecutionNotFoundError(input.executionId);
    const result = await this.executionRepository.findResultByExecutionId(
      execution.id,
    );
    if (!result) throw new ResultNotFoundError(execution.id);
    const pending = createPendingReview(execution, result, input);
    await this.reviewRepository.insertPending(pending.review, pending.gate);
    return pending;
  }

  async approve(
    input: ApproveReviewInput,
  ): Promise<{ review: Review; gate: HumanGate }> {
    const current = await this.#getReviewAndGate(input.reviewId);
    const review = approveReview(
      current.review,
      input.expectedReviewVersion,
      input.occurredAt,
      input.comment,
    );
    const gate = resolveGate(
      current.gate,
      input.expectedGateVersion,
      "passed",
      input.occurredAt,
    );
    await this.reviewRepository.decide(
      review,
      gate,
      undefined,
      input.expectedReviewVersion,
      input.expectedGateVersion,
    );
    return { review, gate };
  }

  async reject(
    input: RejectReviewInput,
  ): Promise<{ review: Review; gate: HumanGate; rework: ReworkRequest }> {
    const current = await this.#getReviewAndGate(input.reviewId);
    const review = rejectReview(
      current.review,
      input.expectedReviewVersion,
      input.occurredAt,
      input.reason,
    );
    const gate = resolveGate(
      current.gate,
      input.expectedGateVersion,
      "rework_required",
      input.occurredAt,
    );
    const rework = createReworkRequest(review, input.reworkRequestId);
    await this.reviewRepository.decide(
      review,
      gate,
      rework,
      input.expectedReviewVersion,
      input.expectedGateVersion,
    );
    return { review, gate, rework };
  }

  async startRework(input: StartReworkInput): Promise<StartedRework> {
    const current = await this.reviewRepository.findRework(
      input.reworkRequestId,
    );
    if (!current) throw new ReworkNotFoundError(input.reworkRequestId);
    const execution = startManualExecution({
      id: input.executionId,
      workItemId: current.workItemId,
      graphVersion: current.graphVersion,
      mode: input.mode,
      executorMemberId: input.executorMemberId,
      startedAt: input.startedAt,
    });
    const rework = startReworkRequest(
      current,
      input.expectedVersion,
      execution,
    );
    await this.reworkStartGuard.assertCanStart({
      workItemId: execution.workItemId,
      graphVersion: execution.graphVersion,
      executorMemberId: execution.executorMemberId,
    });
    await this.reviewRepository.startRework(
      rework,
      execution,
      input.expectedVersion,
    );
    return Object.freeze({ rework, execution });
  }

  async #getReviewAndGate(
    reviewId: string,
  ): Promise<{ review: Review; gate: HumanGate }> {
    const review = await this.reviewRepository.findReview(reviewId);
    if (!review) throw new ReviewNotFoundError(reviewId);
    const gate = await this.reviewRepository.findGateByReviewId(reviewId);
    if (!gate) throw new GateNotFoundError(`for Review ${reviewId}`);
    return { review, gate };
  }
}
