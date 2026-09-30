import type { TableClient } from "@azure/data-tables";
import {
  AzureTableFeedbackStorage,
  FeedbackNotFoundError,
  InMemoryFeedbackStorage,
  InvalidStatusTransitionError,
  seedStorage,
} from "../src/server/storage.js";

const input = {
  title: "Useful workshop",
  description: "Keep the live walkthrough.",
  category: "facilitation" as const,
  displayName: "Grace",
};

describe("in-memory feedback storage", () => {
  it("creates and lists newest feedback first", async () => {
    const storage = new InMemoryFeedbackStorage();
    await storage.create(input, {
      id: "older",
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    await storage.create(
      { ...input, title: "Newer" },
      { id: "newer", createdAt: "2025-01-02T00:00:00.000Z" },
    );

    expect((await storage.list()).map(({ id }) => id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("counts one vote per client and feedback item", async () => {
    const storage = new InMemoryFeedbackStorage();
    const feedback = await storage.create(input);

    const first = await storage.vote(feedback.id, "client-1");
    const duplicate = await storage.vote(feedback.id, "client-1");
    const secondClient = await storage.vote(feedback.id, "client-2");

    expect(first).toMatchObject({ alreadyVoted: false, feedback: { votes: 1 } });
    expect(duplicate).toMatchObject({
      alreadyVoted: true,
      feedback: { votes: 1 },
    });
    expect(secondClient.feedback.votes).toBe(2);
  });

  it("reports missing feedback", async () => {
    const storage = new InMemoryFeedbackStorage();
    await expect(storage.vote("missing", "client-1")).rejects.toBeInstanceOf(
      FeedbackNotFoundError,
    );
  });

  it("seeds deterministic data idempotently", async () => {
    const storage = new InMemoryFeedbackStorage();
    await seedStorage(storage);
    await seedStorage(storage);
    expect(await storage.list()).toHaveLength(2);
  });
});

describe("Azure Table feedback storage", () => {
  it("records the vote marker and counter in one transaction", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue({
        partitionKey: "feedback-1",
        rowKey: "feedback",
        title: input.title,
        description: input.description,
        category: input.category,
        displayName: input.displayName,
        votes: 2,
        createdAt: "2025-01-01T00:00:00.000Z",
        etag: "etag-1",
      }),
      submitTransaction: vi.fn().mockResolvedValue({}),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );

    const result = await storage.vote("feedback-1", "client-1");

    expect(result).toMatchObject({
      alreadyVoted: false,
      feedback: { votes: 3 },
    });
    expect(table.submitTransaction).toHaveBeenCalledOnce();
    const actions = table.submitTransaction.mock.calls[0]?.[0];
    expect(actions).toHaveLength(2);
    expect(actions[0][0]).toBe("create");
    expect(actions[1]).toMatchObject(["update", { votes: 3 }, "Replace"]);
  });

  it("reports an existing Azure vote without increasing the count", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue({
        partitionKey: "feedback-1",
        rowKey: "feedback",
        title: input.title,
        description: input.description,
        category: input.category,
        displayName: input.displayName,
        votes: 2,
        createdAt: "2025-01-01T00:00:00.000Z",
        etag: "etag-1",
      }),
      submitTransaction: vi.fn().mockRejectedValue({ statusCode: 409 }),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );

    await expect(storage.vote("feedback-1", "client-1")).resolves.toMatchObject({
      alreadyVoted: true,
      feedback: { votes: 2 },
    });
  });
});

const legacyEntity = (extra: Record<string, unknown> = {}) => ({
  partitionKey: "feedback-1",
  rowKey: "feedback",
  title: input.title,
  description: input.description,
  category: input.category,
  displayName: input.displayName,
  votes: 2,
  createdAt: "2025-01-01T00:00:00.000Z",
  etag: "etag-1",
  ...extra,
});

// Stateful fake with optimistic concurrency so races behave like the service.
const createFakeTable = (initial: Record<string, unknown>) => {
  let entity = { ...initial } as Record<string, unknown>;
  let version = 1;
  const stamp = () => {
    entity.etag = `etag-${version}`;
  };
  stamp();
  const table = {
    getEntity: vi.fn(async () => ({ ...entity })),
    updateEntity: vi.fn(
      async (
        next: Record<string, unknown>,
        _mode: string,
        options?: { etag?: string },
      ) => {
        if (options?.etag !== entity.etag) {
          throw Object.assign(new Error("Precondition failed"), { statusCode: 412 });
        }
        version += 1;
        entity = { ...next };
        stamp();
      },
    ),
  };
  return {
    table,
    current: () => entity,
    bumpVotes: () => {
      version += 1;
      entity = { ...entity, votes: (entity.votes as number) + 1 };
      stamp();
    },
  };
};

describe("in-memory feedback status", () => {
  it("defaults new and seeded items to new", async () => {
    const storage = new InMemoryFeedbackStorage();
    const created = await storage.create(input);
    await seedStorage(storage);
    expect(created.status).toBe("new");
    expect((await storage.list()).map(({ status }) => status)).toEqual(
      Array(3).fill("new"),
    );
  });

  it("advances forward one step at a time and keeps votes", async () => {
    const storage = new InMemoryFeedbackStorage();
    const { id } = await storage.create(input);
    await storage.vote(id, "client-1");

    const planned = await storage.updateStatus(id, "planned");
    const done = await storage.updateStatus(id, "done");

    expect(planned).toMatchObject({ status: "planned", votes: 1 });
    expect(done).toMatchObject({ status: "done", votes: 1 });
    expect((await storage.list())[0]).toMatchObject({
      status: "done",
      votes: 1,
    });
  });

  it("rejects skip, reverse, and repeat with an actionable error", async () => {
    const storage = new InMemoryFeedbackStorage();
    const { id } = await storage.create(input);

    const skip = await storage.updateStatus(id, "done").catch((e: unknown) => e);
    expect(skip).toBeInstanceOf(InvalidStatusTransitionError);
    expect(skip).toMatchObject({
      from: "new",
      to: "done",
      allowedNext: "planned",
      message: "Status can only move from new to planned.",
    });

    await storage.updateStatus(id, "planned");
    await expect(storage.updateStatus(id, "new")).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
    await expect(storage.updateStatus(id, "planned")).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
    await storage.updateStatus(id, "done");
    await expect(storage.updateStatus(id, "done")).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
    expect((await storage.list())[0]?.status).toBe("done");
  });

  it("rejects an unknown id without creating data", async () => {
    const storage = new InMemoryFeedbackStorage();
    await expect(
      storage.updateStatus("missing", "planned"),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
    expect(await storage.list()).toEqual([]);
  });
});

describe("Azure Table feedback status", () => {
  it("reads a legacy entity without status as new", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue(legacyEntity()),
      submitTransaction: vi.fn().mockResolvedValue({}),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );
    const result = await storage.vote("feedback-1", "client-1");
    expect(result.feedback.status).toBe("new");
  });

  it("reads an unexpected stored status as new", async () => {
    const fake = createFakeTable(legacyEntity({ status: "bogus" }));
    const storage = new AzureTableFeedbackStorage(
      fake.table as unknown as TableClient,
    );
    await expect(storage.updateStatus("feedback-1", "done")).rejects.toMatchObject(
      { from: "new", allowedNext: "planned" },
    );
    await expect(
      storage.updateStatus("feedback-1", "planned"),
    ).resolves.toMatchObject({ status: "planned" });
  });

  it("creates with status new", async () => {
    const createEntity = vi.fn().mockResolvedValue({});
    const storage = new AzureTableFeedbackStorage({
      createEntity,
    } as unknown as TableClient);
    const created = await storage.create(input, { id: "feedback-1" });
    expect(created.status).toBe("new");
    expect(createEntity.mock.calls[0]?.[0]).toMatchObject({ status: "new" });
  });

  it("advances a legacy entity retaining all fields and sends the ETag", async () => {
    const fake = createFakeTable(legacyEntity());
    const storage = new AzureTableFeedbackStorage(
      fake.table as unknown as TableClient,
    );

    const result = await storage.updateStatus("feedback-1", "planned");

    expect(result).toMatchObject({
      id: "feedback-1",
      title: input.title,
      description: input.description,
      category: input.category,
      displayName: input.displayName,
      votes: 2,
      status: "planned",
    });
    expect(fake.table.updateEntity).toHaveBeenCalledOnce();
    const [entity, mode, options] = fake.table.updateEntity.mock.calls[0] as [
      Record<string, unknown>,
      string,
      { etag?: string },
    ];
    expect(mode).toBe("Replace");
    expect(options).toEqual({ etag: "etag-1" });
    expect(entity).toMatchObject({
      partitionKey: "feedback-1",
      rowKey: "feedback",
      title: input.title,
      votes: 2,
      status: "planned",
    });
  });

  it("rejects skip, reverse, and repeat without writing", async () => {
    const fake = createFakeTable(legacyEntity({ status: "planned" }));
    const storage = new AzureTableFeedbackStorage(
      fake.table as unknown as TableClient,
    );
    for (const target of ["new", "planned"] as const) {
      await expect(
        storage.updateStatus("feedback-1", target),
      ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
    }
    const table = createFakeTable(legacyEntity());
    await expect(
      new AzureTableFeedbackStorage(
        table.table as unknown as TableClient,
      ).updateStatus("feedback-1", "done"),
    ).rejects.toMatchObject({
      message: "Status can only move from new to planned.",
    });
    expect(fake.table.updateEntity).not.toHaveBeenCalled();
    expect(table.table.updateEntity).not.toHaveBeenCalled();
  });

  it("reports an unknown id without writing", async () => {
    const table = {
      getEntity: vi.fn().mockRejectedValue({ statusCode: 404 }),
      updateEntity: vi.fn(),
      createEntity: vi.fn(),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );
    await expect(
      storage.updateStatus("missing", "planned"),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
    expect(table.updateEntity).not.toHaveBeenCalled();
    expect(table.createEntity).not.toHaveBeenCalled();
  });

  it("refetches and retries after a 412 and keeps the newer vote count", async () => {
    const fake = createFakeTable(legacyEntity());
    const storage = new AzureTableFeedbackStorage(
      fake.table as unknown as TableClient,
    );
    fake.table.getEntity.mockImplementationOnce(async () => {
      const stale = { ...fake.current() };
      fake.bumpVotes();
      return stale;
    });

    const result = await storage.updateStatus("feedback-1", "planned");

    expect(fake.table.getEntity).toHaveBeenCalledTimes(2);
    expect(fake.table.updateEntity).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "planned", votes: 3 });
    expect(fake.current()).toMatchObject({ status: "planned", votes: 3 });
  });

  it("lets one of two concurrent duplicate advances win and rejects the other", async () => {
    const fake = createFakeTable(legacyEntity());
    const storage = new AzureTableFeedbackStorage(
      fake.table as unknown as TableClient,
    );

    const results = await Promise.allSettled([
      storage.updateStatus("feedback-1", "planned"),
      storage.updateStatus("feedback-1", "planned"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(InvalidStatusTransitionError);
    expect(fake.current().status).toBe("planned");
  });

  it("preserves both a vote and a status change when they race", async () => {
    const fake = createFakeTable(legacyEntity());
    const storage = new AzureTableFeedbackStorage(
      fake.table as unknown as TableClient,
    );
    fake.table.getEntity.mockImplementationOnce(async () => {
      const stale = { ...fake.current() };
      fake.bumpVotes();
      return stale;
    });

    await storage.updateStatus("feedback-1", "planned");

    expect(fake.current()).toMatchObject({ votes: 3, status: "planned" });
  });

  it("keeps status when voting and votes when changing status", async () => {
    const table = {
      getEntity: vi
        .fn()
        .mockResolvedValue(legacyEntity({ status: "planned" })),
      submitTransaction: vi.fn().mockResolvedValue({}),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );
    const result = await storage.vote("feedback-1", "client-1");
    expect(result.feedback).toMatchObject({ votes: 3, status: "planned" });
    expect(table.submitTransaction.mock.calls[0]?.[0][1]).toMatchObject([
      "update",
      { votes: 3, status: "planned" },
      "Replace",
    ]);
  });

  it("gives up after repeated 412 conflicts", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue(legacyEntity()),
      updateEntity: vi.fn().mockRejectedValue({ statusCode: 412 }),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );
    await expect(
      storage.updateStatus("feedback-1", "planned"),
    ).rejects.toMatchObject({ statusCode: 412 });
    expect(table.updateEntity).toHaveBeenCalledTimes(4);
  });
});
