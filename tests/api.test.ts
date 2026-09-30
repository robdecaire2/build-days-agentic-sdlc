import request from "supertest";
import { createApp } from "../src/server/app.js";
import type { Logger } from "../src/server/logger.js";
import {
  InMemoryFeedbackStorage,
  type FeedbackStorage,
} from "../src/server/storage.js";

const silentLogger: Logger = { log: () => undefined };

describe("feedback API", () => {
  it("exposes liveness and storage-backed readiness", async () => {
    const storage = new InMemoryFeedbackStorage();
    const app = createApp({ storage, logger: silentLogger });

    await request(app).get("/health").expect(200, { status: "healthy" });
    await request(app).get("/ready").expect(200, { status: "ready" });
  });

  it("returns 503 when storage is unavailable", async () => {
    const storage = new InMemoryFeedbackStorage();
    storage.checkHealth = () => Promise.reject(new Error("secret details"));
    const app = createApp({ storage, logger: silentLogger });

    const response = await request(app).get("/ready").expect(503);
    expect(response.text).not.toContain("secret details");
    expect(response.body.error.code).toBe("STORAGE_UNAVAILABLE");
  });

  it("creates, lists, and votes on feedback", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });
    const created = await request(app)
      .post("/api/feedback")
      .send({
        title: "  Add a break  ",
        description: "A short break would help.",
        category: "facilitation",
        displayName: "Lin",
      })
      .expect(201);

    expect(created.body.feedback).toMatchObject({
      title: "Add a break",
      votes: 0,
    });
    const id = created.body.feedback.id as string;

    const firstVote = await request(app)
      .post(`/api/feedback/${id}/votes`)
      .send({ clientId: "workshop-client" })
      .expect(201);
    expect(firstVote.body).toMatchObject({
      alreadyVoted: false,
      feedback: { votes: 1 },
    });

    const duplicateVote = await request(app)
      .post(`/api/feedback/${id}/votes`)
      .send({ clientId: "workshop-client" })
      .expect(200);
    expect(duplicateVote.body).toMatchObject({
      alreadyVoted: true,
      feedback: { votes: 1 },
    });

    const list = await request(app).get("/api/feedback").expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].votes).toBe(1);
  });

  it("returns actionable validation without persisting", async () => {
    const storage = new InMemoryFeedbackStorage();
    const app = createApp({ storage, logger: silentLogger });
    const response = await request(app)
      .post("/api/feedback")
      .send({ title: "", description: "", category: "idea", displayName: "" })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: {
        title: ["Enter a title."],
        description: ["Enter a description."],
        displayName: ["Enter your display name."],
      },
    });
    expect(await storage.list()).toEqual([]);
  });

  it("returns a not-found response for votes on missing feedback", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });
    await request(app)
      .post("/api/feedback/missing/votes")
      .send({ clientId: "client-1" })
      .expect(404, {
        error: { code: "NOT_FOUND", message: "Feedback was not found." },
      });
  });

  it("rate-limits repeated application requests without blocking liveness", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await request(app).get("/api/feedback").expect(200);
    }

    await request(app).get("/api/feedback").expect(429, {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again shortly.",
      },
    });
    await request(app).get("/health").expect(200, { status: "healthy" });
  });

  it("converts unexpected storage failures to safe errors", async () => {
    const storage: FeedbackStorage = {
      initialize: () => Promise.resolve(),
      list: () => Promise.reject(new Error("connection string was secret")),
      create: () => Promise.reject(new Error("unused")),
      vote: () => Promise.reject(new Error("unused")),
      updateStatus: () => Promise.reject(new Error("unused")),
      checkHealth: () => Promise.resolve(),
    };
    const app = createApp({ storage, logger: silentLogger });
    const response = await request(app).get("/api/feedback").expect(500);
    expect(response.text).not.toContain("connection string");
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });

  describe("status endpoint", () => {
    const newItem = {
      title: "Add a break",
      description: "A short break would help.",
      category: "facilitation",
      displayName: "Lin",
    };
    const setup = async () => {
      const storage = new InMemoryFeedbackStorage();
      const logs: Array<{ level: string; event: string; fields: unknown }> = [];
      const logger: Logger = {
        log: (level, event, fields) => {
          logs.push({ level, event, fields });
        },
      };
      const app = createApp({ storage, logger });
      const created = await request(app).post("/api/feedback").send(newItem);
      return { storage, app, logs, id: created.body.feedback.id as string };
    };

    it("creates feedback with status new", async () => {
      const { app, id } = await setup();
      const list = await request(app).get("/api/feedback").expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ id, status: "new" });
    });

    it("advances forward and persists in the list", async () => {
      const { app, id } = await setup();
      const planned = await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(200);
      expect(planned.body.feedback).toMatchObject({ id, status: "planned" });
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "done" })
        .expect(200);
      const list = await request(app).get("/api/feedback").expect(200);
      expect(list.body.items[0].status).toBe("done");
    });

    it("rejects skip, reverse, and repeat with 409 and leaves status", async () => {
      const { app, id } = await setup();
      const skip = await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "done" })
        .expect(409);
      expect(skip.body.error).toEqual({
        code: "INVALID_STATUS_TRANSITION",
        message: "Status can only move from new to planned.",
      });
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(200);
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "new" })
        .expect(409);
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(409);
      const list = await request(app).get("/api/feedback").expect(200);
      expect(list.body.items[0].status).toBe("planned");
    });

    it("returns 400 for an unknown status value", async () => {
      const { app, id } = await setup();
      const response = await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "archived" })
        .expect(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      await request(app).patch(`/api/feedback/${id}/status`).send({}).expect(400);
    });

    it("returns 404 for an unknown id without creating data", async () => {
      const { app, storage } = await setup();
      await request(app)
        .patch("/api/feedback/missing/status")
        .send({ status: "planned" })
        .expect(404, {
          error: { code: "NOT_FOUND", message: "Feedback was not found." },
        });
      expect(await storage.list()).toHaveLength(1);
    });

    it("logs status_changed with exactly id, from, and to", async () => {
      const { app, logs, id } = await setup();
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(200);
      const entries = logs.filter((entry) => entry.event === "status_changed");
      expect(entries).toEqual([
        {
          level: "info",
          event: "status_changed",
          fields: { id, from: "new", to: "planned" },
        },
      ]);
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(409);
      expect(logs.filter((entry) => entry.event === "status_changed")).toHaveLength(1);
    });

    it("first vote by a new client after advancing adds one and keeps status", async () => {
      const { app, id } = await setup();
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(200);
      const vote = await request(app)
        .post(`/api/feedback/${id}/votes`)
        .send({ clientId: "client-1" })
        .expect(201);
      expect(vote.body).toMatchObject({
        alreadyVoted: false,
        feedback: { votes: 1, status: "planned" },
      });
    });

    it("advancing after a vote leaves the vote count unchanged", async () => {
      const { app, id } = await setup();
      await request(app)
        .post(`/api/feedback/${id}/votes`)
        .send({ clientId: "client-1" })
        .expect(201);
      const advanced = await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(200);
      expect(advanced.body.feedback).toMatchObject({ votes: 1, status: "planned" });
    });

    it("repeat vote by the same client after advancing is already voted", async () => {
      const { app, id } = await setup();
      await request(app)
        .post(`/api/feedback/${id}/votes`)
        .send({ clientId: "client-1" })
        .expect(201);
      await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" })
        .expect(200);
      const repeat = await request(app)
        .post(`/api/feedback/${id}/votes`)
        .send({ clientId: "client-1" })
        .expect(200);
      expect(repeat.body).toMatchObject({
        alreadyVoted: true,
        feedback: { votes: 1, status: "planned" },
      });
    });

    it("rate-limits status requests with 429 without touching storage", async () => {
      const { app, storage, id } = await setup();
      for (let attempt = 0; attempt < 119; attempt += 1) {
        await request(app).get("/api/feedback").expect(200);
      }
      let calls = 0;
      storage.updateStatus = () => {
        calls += 1;
        return Promise.reject(new Error("should not be called"));
      };
      const response = await request(app)
        .patch(`/api/feedback/${id}/status`)
        .send({ status: "planned" });
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe("RATE_LIMITED");
      expect(calls).toBe(0);
    });
  });
});
