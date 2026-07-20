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

function activityQuery(rows: ReturnType<typeof log>[]) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.range.mockResolvedValue({ data: rows });
  return builder;
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
