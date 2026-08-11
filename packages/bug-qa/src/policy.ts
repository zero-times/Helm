import { RequirementBlockedByBugsError } from "./errors.ts";
import type { BugRepository } from "./repository.ts";
import type {
  BugBlockingEvaluation,
  RequirementGuardInput,
} from "./types.ts";

export class BugBlockingPolicy {
  readonly repository: BugRepository;

  constructor(repository: BugRepository) {
    this.repository = repository;
  }

  async evaluateRequirement(
    input: RequirementGuardInput,
  ): Promise<BugBlockingEvaluation> {
    const bugs = await this.repository.listBlockingBugsForRequirement(
      input.requirementId,
    );
    return Object.freeze({
      allowed: bugs.length === 0,
      blockingBugIds: Object.freeze(bugs.map(({ id }) => id)),
    });
  }

  async assertRequirementCanComplete(input: RequirementGuardInput): Promise<void> {
    await this.#assertAllowed(input);
  }

  async assertRequirementCanRelease(input: RequirementGuardInput): Promise<void> {
    await this.#assertAllowed(input);
  }

  async #assertAllowed(input: RequirementGuardInput): Promise<void> {
    const evaluation = await this.evaluateRequirement(input);
    if (!evaluation.allowed) {
      throw new RequirementBlockedByBugsError(
        input.requirementId,
        evaluation.blockingBugIds,
      );
    }
  }
}
