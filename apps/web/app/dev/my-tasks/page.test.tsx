import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevMyTasksPage from "./page";

// TASK-147 AC#6: this page must 404 in production regardless of who's asking
// (a hidden link alone doesn't stop a direct URL) — it's the owner's only
// window into the hidden personal project's raw data otherwise.
const getUserMock = vi.fn();
let projectRow: { id: string; name: string } | null;
let storyRows: unknown[];
let markRows: unknown[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: projectRow, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "stories") {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: storyRows, error: null }) }) }) };
      }
      if (table === "my_work_story_state") {
        return { select: () => ({ eq: () => Promise.resolve({ data: markRows, error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOTFOUND");
  },
}));

describe("DevMyTasksPage", () => {
  beforeEach(() => {
    projectRow = { id: "p1", name: "My Tasks" };
    storyRows = [];
    markRows = [];
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("404s in production, before even checking who's asking", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(DevMyTasksPage()).rejects.toThrow("NOTFOUND");
  });

  it("renders the personal project's raw data outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    storyRows = [
      {
        id: "s1",
        number: 1,
        title: "Buy milk",
        state_id: null,
        iteration_id: null,
        assignee_id: "user-1",
        completed_at: null,
        project_states: null,
      },
    ];
    markRows = [{ story_id: "s1", column_id: "col-1", today_date: "2026-07-22", today_position: 0, updated_at: "" }];

    render(await DevMyTasksPage());

    expect(screen.getByRole("heading", { name: "Debug: My Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("col-1")).toBeInTheDocument();
  });

  it("404s when the viewer has no personal project (shouldn't happen, but not this page's job to assume)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    projectRow = null;
    await expect(DevMyTasksPage()).rejects.toThrow("NOTFOUND");
  });
});
