import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectActivityPage from "./page";

const { createClientMock, fromMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

function log(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    action: "story.created",
    payload: {},
    created_at: `2026-07-19T12:${String(index).padStart(2, "0")}:00Z`,
    actor: { display_name: "Dev User", is_agent: false },
    story: { title: `Story ${index}` },
  };
}

function projectQuery() {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data: { id: "p1" } });
  return builder;
}

// story is nullable: member.removed is a project-level row with no story.
type ActivityRow = Omit<ReturnType<typeof log>, "story"> & { story: { title: string } | null };

function activityQuery(rows: ActivityRow[]) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    filter: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.filter.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.range.mockResolvedValue({ data: rows });
  return builder;
}

function profilesQuery(rows: { id: string; display_name: string }[]) {
  const builder = { select: vi.fn(), in: vi.fn() };
  builder.select.mockReturnValue(builder);
  builder.in.mockResolvedValue({ data: rows });
  return builder;
}

function assigneeLog(payload: Record<string, unknown>) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    action: "story.assignee_changed",
    payload,
    created_at: "2026-08-03T12:00:00Z",
    actor: { display_name: "Dev User", is_agent: false },
    story: { title: "Add welcome tour" },
  };
}

describe("ProjectActivityPage", () => {
  beforeEach(() => {
    fromMock.mockReset();
    createClientMock.mockResolvedValue({ from: fromMock });
  });

  it("shows 20 activities and an Older link when a lookahead row exists", async () => {
    const query = activityQuery(Array.from({ length: 21 }, (_, index) => log(index)));
    fromMock.mockImplementation((table: string) => (table === "projects" ? projectQuery() : query));

    render(
      await ProjectActivityPage({
        params: Promise.resolve({ id: "p1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByRole("link", { name: "Older" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/projects\/p1\/activity\?before=/),
    );
    expect(screen.queryByRole("link", { name: "Newer" })).not.toBeInTheDocument();
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(query.range).toHaveBeenCalledWith(0, 20);
  });

  // Containerizing a story writes three bookkeeping rows alongside
  // story.containerized; excluded in the query, not after, so a page still
  // holds PAGE_SIZE rows and the lookahead still means what the links assume.
  it("excludes bookkeeping rows in the query rather than after fetching", async () => {
    const query = activityQuery([log(0)]);
    fromMock.mockImplementation((table: string) => (table === "projects" ? projectQuery() : query));

    render(await ProjectActivityPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }));

    expect(query.filter).toHaveBeenCalledWith("payload->>bookkeeping", "is", null);
  });

  // A member removal's cascade rows are collapsed into one member.removed entry
  // (20260804073330). Same reason as bookkeeping for filtering in the query, and
  // a separate key because the story-detail panel must keep showing them.
  it("excludes feed-collapsed rows in the query rather than after fetching", async () => {
    const query = activityQuery([log(0)]);
    fromMock.mockImplementation((table: string) => (table === "projects" ? projectQuery() : query));

    render(await ProjectActivityPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }));

    expect(query.filter).toHaveBeenCalledWith("payload->>feed_collapsed", "is", null);
  });

  it("resolves the removed member's name for a member.removed entry", async () => {
    const removal = {
      id: "00000000-0000-4000-8000-000000000009",
      action: "member.removed",
      payload: { removed_user_id: "u2", story_count: 30, self_leave: false },
      created_at: "2026-08-03T12:00:00Z",
      actor: { display_name: "Dev User", is_agent: false },
      story: null,
    };
    const query = activityQuery([removal]);
    const profiles = profilesQuery([{ id: "u2", display_name: "Rin" }]);
    fromMock.mockImplementation((table: string) =>
      table === "projects" ? projectQuery() : table === "profiles" ? profiles : query,
    );

    render(await ProjectActivityPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }));

    expect(profiles.in).toHaveBeenCalledWith("id", ["u2"]);
    expect(
      screen.getByText("Dev User removed Rin from the project, unassigning 30 stories"),
    ).toBeInTheDocument();
  });

  // The payload carries assignee ids and no names (20260803010000), so the
  // feed is only readable if this page resolves them itself.
  it("resolves an assignee name through a profiles query", async () => {
    const query = activityQuery([assigneeLog({ from_id: null, to_id: "u1" })]);
    const profiles = profilesQuery([{ id: "u1", display_name: "Rin" }]);
    fromMock.mockImplementation((table: string) =>
      table === "projects" ? projectQuery() : table === "profiles" ? profiles : query,
    );

    render(await ProjectActivityPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }));

    expect(profiles.in).toHaveBeenCalledWith("id", ["u1"]);
    expect(screen.getByText('Dev User assigned "Add welcome tour" to Rin')).toBeInTheDocument();
  });

  // A profile the reader's RLS withholds comes back missing, not empty — the
  // row must still say an assignment happened.
  it("falls back to someone when RLS withholds the profile", async () => {
    const query = activityQuery([assigneeLog({ from_id: null, to_id: "u1" })]);
    fromMock.mockImplementation((table: string) =>
      table === "projects" ? projectQuery() : table === "profiles" ? profilesQuery([]) : query,
    );

    render(await ProjectActivityPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Dev User assigned "Add welcome tour" to someone')).toBeInTheDocument();
  });

  // No assignee rows on the page means no ids to resolve, so the extra
  // round trip must not happen at all.
  it("skips the profiles query when the page has no assignee rows", async () => {
    const query = activityQuery([log(0)]);
    const profiles = profilesQuery([]);
    fromMock.mockImplementation((table: string) =>
      table === "projects" ? projectQuery() : table === "profiles" ? profiles : query,
    );

    render(await ProjectActivityPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }));

    expect(profiles.select).not.toHaveBeenCalled();
  });

  it("uses the cursor to fetch older rows and offers a stable Newer cursor", async () => {
    const query = activityQuery([log(21)]);
    fromMock.mockImplementation((table: string) => (table === "projects" ? projectQuery() : query));
    const cursor = Buffer.from(JSON.stringify([log(20).created_at, log(20).id])).toString("base64url");

    render(
      await ProjectActivityPage({
        params: Promise.resolve({ id: "p1" }),
        searchParams: Promise.resolve({ before: cursor }),
      }),
    );

    expect(screen.getByRole("link", { name: "Newer" })).toHaveAttribute("href", expect.stringContaining("after="));
    expect(screen.queryByRole("link", { name: "Older" })).not.toBeInTheDocument();
    expect(query.or).toHaveBeenCalledWith(
      expect.stringContaining(`created_at.lt.${log(20).created_at}`),
    );
    expect(query.range).toHaveBeenCalledWith(0, 20);
  });

  it("treats an invalid cursor as the first page", async () => {
    const query = activityQuery([]);
    fromMock.mockImplementation((table: string) => (table === "projects" ? projectQuery() : query));

    render(
      await ProjectActivityPage({
        params: Promise.resolve({ id: "p1" }),
        searchParams: Promise.resolve({ before: "invalid" }),
      }),
    );

    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
    expect(query.range).toHaveBeenCalledWith(0, 20);
  });

  it("distinguishes an exhausted cursor from a project with no activity", async () => {
    const query = activityQuery([]);
    fromMock.mockImplementation((table: string) => (table === "projects" ? projectQuery() : query));
    const cursor = Buffer.from(JSON.stringify([log(20).created_at, log(20).id])).toString("base64url");

    render(
      await ProjectActivityPage({
        params: Promise.resolve({ id: "p1" }),
        searchParams: Promise.resolve({ before: cursor }),
      }),
    );

    expect(screen.getByText("No more activity.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Newer" })).toHaveAttribute(
      "href",
      "/projects/p1/activity",
    );
  });
});
