import {
  GateBlockedError,
  GateNotFoundError,
  ReviewValidationError,
} from "./errors.ts";
import type { ReviewRepository } from "./repository.ts";
import type {
  GateEvaluation,
  ReviewedCompletionInput,
} from "./types.ts";

/**
 * Shared policy for HELM-10 composition. Work Graph transitions must call
 * these guards instead of checking a Review or gate status ad hoc.
 */
export class HumanGatePolicy {
  readonly repository: ReviewRepository;

  constructor(repository: ReviewRepository) {
    this.repository = repository;
  }

  async evaluateDownstreamReadiness(
    requiredGateIds: readonly string[],
  ): Promise<GateEvaluation> {
    const blockingGateIds: string[] = [];
    for (const gateId of requiredGateIds) {
      const gate = await this.repository.findGate(gateId);
      if (!gate || gate.status !== "passed") blockingGateIds.push(gateId);
    }
    return Object.freeze({
      ready: blockingGateIds.length === 0,
      blockingGateIds: Object.freeze(blockingGateIds),
    });
  }

  async assertDownstreamCanBecomeReady(
    requiredGateIds: readonly string[],
  ): Promise<void> {
    const evaluation = await this.evaluateDownstreamReadiness(requiredGateIds);
    if (!evaluation.ready) {
      throw new GateBlockedError(evaluation.blockingGateIds);
    }
  }

  async assertReviewedWorkItemCanComplete(
    input: ReviewedCompletionInput,
  ): Promise<void> {
    const gate = await this.repository.findGate(input.gateId);
    if (!gate) throw new GateNotFoundError(input.gateId);
    if (
      gate.workItemId !== input.workItemId ||
      gate.graphVersion !== input.graphVersion
    ) {
      throw new ReviewValidationError(
        "Human gate does not belong to the reviewed WorkItem graph version",
      );
    }
    if (gate.status !== "passed") {
      throw new GateBlockedError([gate.id]);
    }
  }
}
