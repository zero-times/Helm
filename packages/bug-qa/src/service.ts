import { BugNotFoundError, QaRegressionNotFoundError } from "./errors.ts";
import {
  completeQaRegression,
  createBug,
  startBugFix,
  submitFixForQa,
} from "./bug.ts";
import type { BugRepository } from "./repository.ts";
import type {
  BugWorkItem,
  CompleteQaRegressionInput,
  CreateBugInput,
  PassedReviewGateReader,
  QaRegressionEdge,
  StartBugFixInput,
  SubmitFixForQaInput,
} from "./types.ts";

export class BugQaWorkflowService {
  readonly repository: BugRepository;
  readonly reviewGates: PassedReviewGateReader;

  constructor(
    repository: BugRepository,
    reviewGates: PassedReviewGateReader,
  ) {
    this.repository = repository;
    this.reviewGates = reviewGates;
  }

  async create(input: CreateBugInput): Promise<BugWorkItem> {
    const bug = createBug(input);
    await this.repository.insertBug(bug);
    return bug;
  }

  async startFix(input: StartBugFixInput): Promise<BugWorkItem> {
    const current = await this.#getBug(input.bugId);
    const bug = startBugFix(current, input);
    await this.repository.saveBug(bug, input.expectedBugVersion);
    return bug;
  }

  async submitFixForQa(input: SubmitFixForQaInput): Promise<{
    readonly bug: BugWorkItem;
    readonly regression: QaRegressionEdge;
  }> {
    const current = await this.#getBug(input.bugId);
    await this.reviewGates.assertReviewedWorkItemCanComplete({
      gateId: input.passedGateId,
      workItemId: current.id,
      graphVersion: current.graphVersion,
    });
    const submitted = submitFixForQa(current, input);
    await this.repository.submitFixForQa(
      submitted.bug,
      submitted.fix,
      submitted.regression,
      input.expectedBugVersion,
    );
    return Object.freeze({
      bug: submitted.bug,
      regression: submitted.regression,
    });
  }

  async completeRegression(input: CompleteQaRegressionInput): Promise<{
    readonly bug: BugWorkItem;
    readonly regression: QaRegressionEdge;
  }> {
    const regression = await this.repository.findRegression(
      input.regressionEdgeId,
    );
    if (!regression) {
      throw new QaRegressionNotFoundError(input.regressionEdgeId);
    }
    const bug = await this.#getBug(regression.bugId);
    const completed = completeQaRegression(bug, regression, input);
    await this.repository.completeRegression(
      completed.bug,
      completed.regression,
      input.expectedBugVersion,
      input.expectedRegressionVersion,
    );
    return completed;
  }

  async #getBug(bugId: string): Promise<BugWorkItem> {
    const bug = await this.repository.findBug(bugId);
    if (!bug) throw new BugNotFoundError(bugId);
    return bug;
  }
}
