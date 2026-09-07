import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardPage } from "./BoardPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Dispatches by "METHOD url" so call order (board vs. project vs. an action) never matters,
 * and — unlike `mockResolvedValue`, which hands out the same already-consumed `Response` to
 * every call — always builds a fresh `Response` per call. */
function mockApi(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    return handler();
  });
}

const project = { pointScale: "fibonacci", customPoints: null };

const board = {
  states: [
    { id: "todo", name: "Unstarted", category: "unstarted", actionLabel: "Start", position: 0 },
    { id: "doing", name: "Started", category: "in_progress", actionLabel: "Finish", position: 1 },
    { id: "done", name: "Accepted", category: "done", actionLabel: null, position: 2 },
  ],
  columns: [
    { stateId: null, stories: [{ id: "s1", number: 1, title: "Iced", storyType: "feature", stateId: null, position: 0, points: null, completedAt: null, assigneeId: null, requesterId: null, description: null }] },
    { stateId: "todo", stories: [{ id: "s2", number: 2, title: "Ready", storyType: "feature", stateId: "todo", position: 0, points: 2, completedAt: null, assigneeId: null, requesterId: null, description: null }] },
    { stateId: "doing", stories: [] },
    { stateId: "done", stories: [] },
  ],
};

describe("BoardPage", () => {
  it("renders one column per state plus the Icebox, with counts and point sums", async () => {
    mockApi({
      "GET /api/projects/p1/board": () => json(200, board),
      "GET /api/projects/p1": () => json(200, project),
    });
    render(<BoardPage projectId="p1" />);
    expect(await screen.findByRole("heading", { name: /icebox/i })).toBeInTheDocument();
    for (const name of ["Unstarted", "Started", "Accepted"]) {
      expect(screen.getByRole("heading", { name: new RegExp(`^${name}$`, "i") })).toBeInTheDocument();
    }
    expect(screen.getByTestId("column-todo-points")).toHaveTextContent("2");
    expect(screen.getByTestId("column-todo-count")).toHaveTextContent("1");
  });

  it("shows the story number and title on every card", async () => {
    mockApi({
      "GET /api/projects/p1/board": () => json(200, board),
      "GET /api/projects/p1": () => json(200, project),
    });
    render(<BoardPage projectId="p1" />);
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });

  it("advances a story with its state's action label and refetches", async () => {
    const fetchSpy = mockApi({
      "GET /api/projects/p1/board": () => json(200, board),
      "GET /api/projects/p1": () => json(200, project),
      "POST /api/projects/p1/stories/s2/move": () => json(200, { id: "s2", stateId: "doing" }),
    });
    render(<BoardPage projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    const moveCall = await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/stories/s2/move"));
      if (!call) throw new Error("move not called yet");
      return call as [string, RequestInit];
    });
    const [path, init] = moveCall;
    expect(path).toBe("/api/projects/p1/stories/s2/move");
    expect(JSON.parse(init.body as string)).toEqual({ stateId: "doing", orderedIds: ["s2"] });
  });

  it("quick-adds a story into the Icebox, where new stories land", async () => {
    const fetchSpy = mockApi({
      "GET /api/projects/p1/board": () => json(200, board),
      "GET /api/projects/p1": () => json(200, project),
      "POST /api/projects/p1/stories": () => json(201, { id: "s3", number: 3, title: "New one" }),
    });
    render(<BoardPage projectId="p1" />);
    const iceboxColumn = await screen.findByTestId("column-icebox");
    await userEvent.click(within(iceboxColumn).getByRole("button", { name: /add a story/i }));
    await userEvent.type(within(iceboxColumn).getByLabelText(/title/i), "New one");
    await userEvent.click(within(iceboxColumn).getByRole("button", { name: /^add$/i }));
    const createCall = await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([url]) => String(url) === "/api/projects/p1/stories");
      if (!call) throw new Error("create not called yet");
      return call as [string, RequestInit];
    });
    const [, init] = createCall;
    expect(JSON.parse(init.body as string)).toMatchObject({ title: "New one", stateId: null });
  });

  it("surfaces a rejected move and puts the card back", async () => {
    mockApi({
      "GET /api/projects/p1/board": () => json(200, board),
      "GET /api/projects/p1": () => json(200, project),
      "POST /api/projects/p1/stories/s2/move": () => json(409, { error: "estimate_required" }),
    });
    render(<BoardPage projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/estimate/i);
    // The optimistic move was rolled back: the card is in Unstarted again.
    await waitFor(() => expect(screen.getByTestId("column-todo-count")).toHaveTextContent("1"));
  });

  it("clears pending and shows an error when the post-move reload itself fails", async () => {
    let boardCalls = 0;
    mockApi({
      "GET /api/projects/p1/board": () => {
        boardCalls += 1;
        // The mount fetch succeeds; the reload triggered by the move's own success fails once.
        return boardCalls === 1 ? json(200, board) : json(500, { error: "unexpected" });
      },
      "GET /api/projects/p1": () => json(200, project),
      "POST /api/projects/p1/stories/s2/move": () => json(200, { id: "s2", stateId: "doing" }),
    });
    render(<BoardPage projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    // The optimistic view must not stick forever just because the confirming reload failed.
    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
    await waitFor(() => expect(screen.getByTestId("column-todo-count")).toHaveTextContent("1"));
  });

  it("keeps both moves when a second drag starts before the first reload settles", async () => {
    const twoStoryBoard = {
      ...board,
      columns: [
        { stateId: null, stories: [] },
        {
          stateId: "todo",
          stories: [
            { id: "s2", number: 2, title: "Ready", storyType: "feature", stateId: "todo", position: 0, points: 2, completedAt: null, assigneeId: null, requesterId: null, description: null },
            { id: "s10", number: 10, title: "Also ready", storyType: "feature", stateId: "todo", position: 1, points: 2, completedAt: null, assigneeId: null, requesterId: null, description: null },
          ],
        },
        { stateId: "doing", stories: [] },
        { stateId: "done", stories: [] },
      ],
    };
    const finalBoard = {
      ...twoStoryBoard,
      columns: [
        { stateId: null, stories: [] },
        { stateId: "todo", stories: [] },
        {
          stateId: "doing",
          stories: twoStoryBoard.columns[1]!.stories.map((s) => ({ ...s, stateId: "doing" })),
        },
        { stateId: "done", stories: [] },
      ],
    };

    let boardCalls = 0;
    const slowReload: { release: (() => void) | null } = { release: null };
    mockApi({
      "GET /api/projects/p1/board": () => {
        boardCalls += 1;
        if (boardCalls === 1) return json(200, twoStoryBoard);
        if (boardCalls === 2) {
          // The reload kicked off by the *first* move deliberately never resolves until we
          // release it below — by then a second move has already landed and superseded it.
          return new Promise<Response>((resolve) => {
            slowReload.release = () => resolve(json(200, finalBoard));
          });
        }
        return json(200, finalBoard);
      },
      "GET /api/projects/p1": () => json(200, project),
      "POST /api/projects/p1/stories/s2/move": () => json(200, {}),
      "POST /api/projects/p1/stories/s10/move": () => json(200, {}),
    });

    render(<BoardPage projectId="p1" />);
    await screen.findByText("Ready");
    await screen.findByText("Also ready");

    await userEvent.click(screen.getAllByRole("button", { name: /^start$/i })[0]!);
    await waitFor(() => expect(boardCalls).toBe(2));

    // Second drag starts while the first move's confirming reload is still in flight. Scoped to
    // the "todo" column: the first story's own card still shows a stale "Start" too (its
    // `stateId` only catches up once the real board data arrives), but it no longer lives here.
    const todoColumn = screen.getByTestId("column-todo");
    await userEvent.click(within(todoColumn).getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(boardCalls).toBe(3));

    // The stale first reload finally resolves — it must not clobber the second move's outcome.
    slowReload.release?.();

    await waitFor(() => expect(screen.getByTestId("column-doing-count")).toHaveTextContent("2"));
    expect(screen.getByTestId("column-todo-count")).toHaveTextContent("0");
  });

  it("does not render a disabled advance button on a done story (principle 1)", async () => {
    const doneBoard = {
      ...board,
      columns: [
        { stateId: null, stories: [] },
        { stateId: "todo", stories: [] },
        { stateId: "doing", stories: [] },
        { stateId: "done", stories: [{ ...board.columns[1]!.stories[0]!, id: "s9", stateId: "done", completedAt: 1_700_000_000_000 }] },
      ],
    };
    mockApi({
      "GET /api/projects/p1/board": () => json(200, doneBoard),
      "GET /api/projects/p1": () => json(200, project),
    });
    render(<BoardPage projectId="p1" />);
    await screen.findByText("Ready");
    expect(screen.queryAllByRole("button", { name: /start|finish/i })).toHaveLength(0);
  });
});
