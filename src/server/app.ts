import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import { rateLimit } from "express-rate-limit";
import { ZodError, type ZodType } from "zod";
import {
  createFeedbackSchema,
  feedbackStatuses,
  nextStatus,
  updateStatusSchema,
  voteRequestSchema,
  type ApiError,
  type CreateFeedbackRequest,
  type FeedbackStatus,
  type UpdateStatusRequest,
  type VoteRequest,
} from "../shared/contracts.js";
import { logger as defaultLogger, type Logger } from "./logger.js";
import {
  FeedbackNotFoundError,
  InvalidStatusTransitionError,  type FeedbackStorage,
} from "./storage.js";

export interface AppOptions {
  storage: FeedbackStorage;
  logger?: Logger;
  staticDirectory?: string;
}

export const createApp = ({
  storage,
  logger = defaultLogger,
  staticDirectory,
}: AppOptions) => {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));
  app.use((request, response, next) => {
    const requestId = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", requestId);
    const startedAt = performance.now();
    response.on("finish", () => {
      logger.log("info", "http_request", {
        requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: (request) => request.path === "/health",
      handler: (_request, response) => {
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Try again shortly.",
          },
        } satisfies ApiError);
      },
    }),
  );

  app.get("/health", (_request, response) => {
    response.json({ status: "healthy" });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await storage.checkHealth();
      response.json({ status: "ready" });
    } catch (error) {
      logger.log("error", "readiness_failed", {
        error: error instanceof Error ? error.message : "Unknown storage error",
      });
      response.status(503).json({
        status: "not_ready",
        error: { code: "STORAGE_UNAVAILABLE", message: "Storage is unavailable." },
      });
    }
  });

  app.get("/api/feedback", async (_request, response) => {
    response.json({ items: await storage.list() });
  });

  app.post(
    "/api/feedback",
    validateBody(createFeedbackSchema),
    async (request, response) => {
      const feedback = await storage.create(
        request.body as CreateFeedbackRequest,
      );
      response.status(201).json({ feedback });
    },
  );

  app.post(
    "/api/feedback/:id/votes",
    validateBody(voteRequestSchema),
    async (request, response) => {
      const id = request.params.id;
      if (typeof id !== "string") {
        response.status(404).json({
          error: { code: "NOT_FOUND", message: "Feedback was not found." },
        } satisfies ApiError);
        return;
      }
      const { clientId } = request.body as VoteRequest;
      const result = await storage.vote(id, clientId);
      response.status(result.alreadyVoted ? 200 : 201).json(result);
    },
  );

  app.patch(
    "/api/feedback/:id/status",
    validateBody(updateStatusSchema),
    async (request, response) => {
      const id = request.params.id;
      if (typeof id !== "string") {
        response.status(404).json({
          error: { code: "NOT_FOUND", message: "Feedback was not found." },
        } satisfies ApiError);
        return;
      }
      const { status } = request.body as UpdateStatusRequest;
      const feedback = await storage.updateStatus(id, status);
      logger.log("info", "status_changed", {
        id,
        from: previousStatus(status),
        to: status,
      });
      response.json({ feedback });
    },
  );
  if (staticDirectory) {
    app.use(express.static(staticDirectory));
    app.get("*splat", (_request, response) => {
      response.sendFile("index.html", { root: staticDirectory });
    });
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof FeedbackNotFoundError) {
      response.status(404).json({
        error: { code: "NOT_FOUND", message: "Feedback was not found." },
      } satisfies ApiError);
      return;
    }
    if (error instanceof InvalidStatusTransitionError) {
      response.status(409).json({
        error: { code: "INVALID_STATUS_TRANSITION", message: error.message },
      } satisfies ApiError);
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({
        error: { code: "INVALID_JSON", message: "Request body must be valid JSON." },
      } satisfies ApiError);
      return;
    }
    logger.log("error", "request_failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    } satisfies ApiError);
  };
  app.use(errorHandler);

  return app;
};

function validateBody(schema: ZodType): RequestHandler {
  return (request, response, next) => {
    try {
      request.body = schema.parse(request.body);
      next();
    } catch (error) {
      if (!(error instanceof ZodError)) {
        next(error);
        return;
      }
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const field = String(issue.path[0] ?? "request");
        (fieldErrors[field] ??= []).push(issue.message);
      }
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the highlighted fields and try again.",
          fieldErrors,
        },
      } satisfies ApiError);
    }
  };
}

const previousStatus = (status: FeedbackStatus): FeedbackStatus =>
  feedbackStatuses.find((candidate) => nextStatus(candidate) === status) ?? status;
