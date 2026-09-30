// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/client/App.js";
import type { Feedback, FeedbackStatus } from "../src/shared/contracts.js";

type Item = Feedback;

const makeItem = (id: string, title: string, status: FeedbackStatus = "new"): Item => ({
  id,
  title,
  description: "Details",
  category: "idea",
  displayName: "Sam",
  votes: 2,
  createdAt: "2025-01-01T00:00:00.000Z",
  status,
});

const apiError = (status: number, message: string, code = "ERROR"): Response =>
  jsonResponse({ error: { code, message } }, status);

const advanceButton = (title: string, target: string) =>
  screen.getByRole("button", { name: `Mark ${title} as ${target}` });

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("feedback board", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows an accessible empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ items: [] }));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading feedback");
    expect(await screen.findByRole("heading", { name: "No feedback yet" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Mark / })).toBeNull();
    expect(screen.queryByText(/Workshop only/)).toBeNull();
  });

  it("creates feedback and votes through the complete UI flow", async () => {
    let item: Feedback | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === "/api/feedback" && !options?.method) {
        return jsonResponse({ items: [] });
      }
      if (url === "/api/feedback" && options?.method === "POST") {
        item = {
          id: "feedback-1",
          ...(JSON.parse(String(options.body)) as Omit<
            Feedback,
            "id" | "votes" | "createdAt"
          >),
          votes: 0,
          createdAt: "2025-01-01T00:00:00.000Z",
        };
        return jsonResponse({ feedback: item }, 201);
      }
      if (url.endsWith("/votes") && item) {
        item = { ...item, votes: 1 };
        return jsonResponse({ feedback: item, alreadyVoted: false }, 201);
      }
      return jsonResponse({}, 404);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "No feedback yet" });

    await user.type(screen.getByLabelText("Title"), "Better examples");
    await user.type(
      screen.getByLabelText("Description"),
      "Show another API example.",
    );
    await user.selectOptions(screen.getByLabelText("Category"), "tooling");
    await user.type(screen.getByLabelText("Display name"), "Sam");
    await user.click(screen.getByRole("button", { name: "Add feedback" }));

    expect(
      await screen.findByRole("heading", { name: "Better examples" }),
    ).toBeVisible();
    const vote = screen.getByRole("button", {
      name: "Vote for Better examples. 0 votes",
    });
    await user.click(vote);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Vote for Better examples. 1 votes",
        }),
      ).toBeVisible(),
    );
    expect(screen.getByText("Vote added for “Better examples”.")).toBeVisible();
  });

  it("shows server validation beside fields", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Check the highlighted fields and try again.",
              fieldErrors: { title: ["Enter a title."] },
            },
          },
          400,
        ),
      );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "No feedback yet" });
    await user.click(screen.getByRole("button", { name: "Add feedback" }));

    expect(await screen.findByText("Enter a title.")).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  });

  it("offers retry after a loading error", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Something went wrong. Try again.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No feedback yet" })).toBeVisible();
  });

  describe("feedback status", () => {
    const mockBoard = (
      items: Item[],
      patch: (id: string, status: string) => Response | Promise<Response>,
    ) =>
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
        const url = String(input);
        if (url === "/api/feedback" && !options?.method) {
          return jsonResponse({ items });
        }
        const match = /^\/api\/feedback\/([^/]+)\/status$/.exec(url);
        if (match && options?.method === "PATCH") {
          const { status } = JSON.parse(String(options.body)) as {
            status: FeedbackStatus;
          };
          const response = await patch(match[1]!, status);
          if (response.ok) {
            const index = items.findIndex((item) => item.id === match[1]);
            items[index] = { ...items[index]!, status };
            return jsonResponse({ feedback: items[index] });
          }
          return response;
        }
        return jsonResponse({}, 404);
      });

    it("shows status text, the workshop-only note, and named controls", async () => {
      mockBoard(
        [
          makeItem("1", "Legacy item"),
          makeItem("2", "Planned item", "planned"),
          makeItem("3", "Done item", "done"),
        ],
        () => jsonResponse({}),
      );
      render(<App />);
      await screen.findByRole("heading", { name: "Legacy item" });
      expect(screen.getAllByText("Status: new")).toHaveLength(1);
      expect(screen.getByText("Status: planned")).toBeVisible();
      expect(screen.getByText("Status: done")).toBeVisible();
      expect(
        screen.getByText(
          "Workshop only: anyone using this board can advance status.",
        ),
      ).toBeVisible();
      expect(advanceButton("Legacy item", "planned")).toBeVisible();
      expect(advanceButton("Planned item", "done")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: /Mark Done item/ }),
      ).toBeNull();
    });

    it("advances an item and keeps the status after a refresh", async () => {
      mockBoard([makeItem("1", "Better examples", "new")], () => jsonResponse({}));
      const user = userEvent.setup();
      const first = render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(advanceButton("Better examples", "planned"));

      expect(await screen.findByText("Status: planned")).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(
        "“Better examples” is now planned.",
      );
      expect(advanceButton("Better examples", "done")).toBeEnabled();

      first.unmount();
      render(<App />);
      expect(await screen.findByText("Status: planned")).toBeVisible();
    });

    it("disables only the activated item while updating", async () => {
      let release: (response: Response) => void = () => undefined;
      mockBoard([makeItem("1", "First"), makeItem("2", "Second")], () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "First" });
      await user.click(advanceButton("First", "planned"));

      expect(await screen.findByText("Updating First")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Mark First as planned" }),
      ).toBeDisabled();
      expect(advanceButton("Second", "planned")).toBeEnabled();
      release(jsonResponse({}));
      expect(await screen.findByText("Status: planned")).toBeVisible();
      expect(screen.queryByText("Updating First")).toBeNull();
    });

    it("shows a server error naming the item and recovers", async () => {
      mockBoard([makeItem("1", "Better examples")], () =>
        apiError(400, "Enter a valid status.", "VALIDATION_ERROR"),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(advanceButton("Better examples", "planned"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not update “Better examples”: Enter a valid status.",
      );
      expect(screen.getByText("Status: new")).toBeVisible();
      expect(advanceButton("Better examples", "planned")).toBeEnabled();
    });

    it("shows the rate-limit message on 429", async () => {
      mockBoard([makeItem("1", "Better examples")], () =>
        apiError(429, "Too many requests. Try again shortly.", "RATE_LIMITED"),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(advanceButton("Better examples", "planned"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Too many requests. Try again shortly.",
      );
      expect(screen.getByText("Status: new")).toBeVisible();
      expect(advanceButton("Better examples", "planned")).toBeEnabled();
    });

    it("falls back to the rate-limit message when the 429 body is not JSON", async () => {
      mockBoard([makeItem("1", "Better examples")], () =>
        new Response("Slow down", { status: 429 }),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(advanceButton("Better examples", "planned"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Too many requests. Try again shortly.",
      );
    });

    it("shows a generic message when the network fails", async () => {
      mockBoard([makeItem("1", "Better examples")], () => {
        throw new TypeError("Failed to fetch");
      });
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(advanceButton("Better examples", "planned"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not update “Better examples”: Something went wrong. Try again.",
      );
      expect(screen.getByText("Status: new")).toBeVisible();
      expect(advanceButton("Better examples", "planned")).toBeEnabled();
    });

    it("shows a generic message when the error body is malformed", async () => {
      mockBoard([makeItem("1", "Better examples")], () =>
        new Response("<html>oops</html>", { status: 500 }),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(advanceButton("Better examples", "planned"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not update “Better examples”: Something went wrong. Try again.",
      );
      expect(advanceButton("Better examples", "planned")).toBeEnabled();
    });

    it("reloads the list on a stale 409 and announces the change", async () => {
      const items = [makeItem("1", "Better examples")];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, options) => {
        if (options?.method === "PATCH") {
          items[0] = { ...items[0]!, status: "planned", votes: 5 };
          return apiError(
            409,
            "Status can only move from planned to done.",
            "INVALID_STATUS_TRANSITION",
          );
        }
        return jsonResponse({ items });
      });
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(advanceButton("Better examples", "planned"));

      expect(await screen.findByText("Status: planned")).toBeVisible();
      expect(
        screen.getByRole("button", {
          name: "Vote for Better examples. 5 votes",
        }),
      ).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent(
        "“Better examples” was changed elsewhere",
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("does not revert status when a late vote response arrives", async () => {
      let item = makeItem("1", "Better examples", "new");
      let releaseVote: (response: Response) => void = () => undefined;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
        const url = String(input);
        if (url.endsWith("/votes")) {
          return new Promise<Response>((resolve) => {
            releaseVote = resolve;
          });
        }
        if (options?.method === "PATCH") {
          item = { ...item, status: "planned" };
          return jsonResponse({ feedback: item });
        }
        return jsonResponse({ items: [item] });
      });
      const user = userEvent.setup();
      render(<App />);
      await screen.findByRole("heading", { name: "Better examples" });
      await user.click(
        screen.getByRole("button", { name: "Vote for Better examples. 2 votes" }),
      );
      await user.click(advanceButton("Better examples", "planned"));
      await screen.findByText("Status: planned");

      releaseVote(
        jsonResponse(
          {
            feedback: { ...makeItem("1", "Better examples", "new"), votes: 3 },
            alreadyVoted: false,
          },
          201,
        ),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: "Vote for Better examples. 3 votes",
          }),
        ).toBeVisible(),
      );
      expect(screen.getByText("Status: planned")).toBeVisible();
    });

    it("has a list of items with the status inside each card", async () => {
      mockBoard([makeItem("1", "Card one", "planned")], () => jsonResponse({}));
      render(<App />);
      const card = (await screen.findByRole("heading", { name: "Card one" }))
        .closest("li")!;
      expect(within(card).getByText("Status: planned")).toBeVisible();
    });
  });
});
