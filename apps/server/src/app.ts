import cors from '@fastify/cors';
import type { ServerConfig } from '@helm/config';
import { DomainError } from '@helm/core-domain';
import type { Database } from '@helm/database';
import {
  BugDomainError,
  BugNotFoundError,
  BugVersionConflictError,
  DuplicateBugRecordError,
  InvalidBugTransitionError,
  InvalidQaRegressionTransitionError,
  QaRegressionNotFoundError,
  QaRegressionVersionConflictError,
  RequirementBlockedByBugsError,
} from '@helm/bug-qa';
import {
  ExecutionDomainError,
  ExecutionNotFoundError,
  ExecutionVersionConflictError,
  InvalidExecutionTransitionError,
  ResultAlreadyExistsError,
} from '@helm/execution';
import {
  DuplicateReviewError,
  GateBlockedError,
  GateNotFoundError,
  GateVersionConflictError,
  InvalidGateTransitionError,
  InvalidReviewTransitionError,
  InvalidReworkTransitionError,
  ResultNotFoundError,
  ReviewDomainError,
  ReviewNotFoundError,
  ReviewVersionConflictError,
  ReworkNotFoundError,
  ReworkVersionConflictError,
} from '@helm/review';
import Fastify, {
  type FastifyError,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError } from 'zod';

import { healthRoutes } from './routes/health';
import { bugRoutes } from './routes/bugs';
import { executionRoutes } from './routes/executions';
import { memberRoutes } from './routes/members';
import { organizationRoutes } from './routes/organizations';
import { projectRoutes } from './routes/projects';
import { requirementRoutes } from './routes/requirements';
import { reviewRoutes } from './routes/reviews';
import { roleAssignmentRoutes } from './routes/role-assignments';
import { workGraphRoutes } from './routes/work-graphs';

export interface BuildAppOptions {
  config: Pick<ServerConfig, 'APP_VERSION' | 'WEB_ORIGIN'>;
  checkDatabase: () => Promise<void>;
  database: Database;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(options: BuildAppOptions) {
  const server = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: 'x-request-id',
  });

  void server.register(cors, {
    origin: options.config.WEB_ORIGIN,
    credentials: true,
  });

  void server.register(healthRoutes, {
    version: options.config.APP_VERSION,
    checkDatabase: options.checkDatabase,
  });

  void server.register(organizationRoutes, { database: options.database });
  void server.register(memberRoutes, { database: options.database });
  void server.register(roleAssignmentRoutes, { database: options.database });
  void server.register(projectRoutes, { database: options.database });
  void server.register(requirementRoutes, { database: options.database });
  void server.register(workGraphRoutes, { database: options.database });
  void server.register(executionRoutes, { database: options.database });
  void server.register(reviewRoutes, { database: options.database });
  void server.register(bugRoutes, { database: options.database });

  server.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Request failed');

    if (error instanceof ZodError) {
      void reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.issues,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof DomainError) {
      void reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof ExecutionNotFoundError) {
      void reply.code(404).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (
      error instanceof ExecutionVersionConflictError ||
      error instanceof InvalidExecutionTransitionError ||
      error instanceof ResultAlreadyExistsError
    ) {
      void reply.code(409).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof ExecutionDomainError) {
      void reply.code(400).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (
      error instanceof ReviewNotFoundError ||
      error instanceof GateNotFoundError ||
      error instanceof ReworkNotFoundError ||
      error instanceof ResultNotFoundError
    ) {
      void reply.code(404).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (
      error instanceof DuplicateReviewError ||
      error instanceof GateBlockedError ||
      error instanceof ReviewVersionConflictError ||
      error instanceof GateVersionConflictError ||
      error instanceof ReworkVersionConflictError ||
      error instanceof InvalidReviewTransitionError ||
      error instanceof InvalidGateTransitionError ||
      error instanceof InvalidReworkTransitionError
    ) {
      void reply.code(409).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof ReviewDomainError) {
      void reply.code(400).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof BugNotFoundError || error instanceof QaRegressionNotFoundError) {
      void reply.code(404).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (
      error instanceof BugVersionConflictError ||
      error instanceof QaRegressionVersionConflictError ||
      error instanceof DuplicateBugRecordError ||
      error instanceof InvalidBugTransitionError ||
      error instanceof InvalidQaRegressionTransitionError ||
      error instanceof RequirementBlockedByBugsError
    ) {
      void reply.code(409).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    if (error instanceof BugDomainError) {
      void reply.code(400).send({
        error: error.name,
        message: error.message,
        requestId: request.id,
      });
      return;
    }

    void reply.code(error.statusCode ?? 500).send({
      error: error.name,
      message:
        error.statusCode !== undefined && error.statusCode < 500
          ? error.message
          : 'Internal server error',
      requestId: request.id,
    });
  });

  return server;
}
