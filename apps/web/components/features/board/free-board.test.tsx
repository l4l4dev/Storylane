import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FreeBoard, WipLimitMenu, type CustomStatus, type Swimlane } from "./free-board";

const { setStatusWipLimitMock } = vi.hoisted(() => ({
  setStatusWipLimitMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/settings/actions", () => ({
  setStatusWipLimit: setStatusWipLimitMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/realtime", () => ({
  useProjectBoardRealtime: () => {},
}));

const { dropStoryFreeMock, quickCreateStoryFreeMock } = vi.hoisted(() => ({
  dropStoryFreeMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  quickCreateStoryFreeMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  dropStoryFree: dropStoryFreeMock,
  quickCreateStory: vi.fn(),
  quickCreateStoryFree: quickCreateStoryFreeMock,
}));

describe("WipLimitMenu", () => {
  beforeEach(() => {
    setStatusWipLimitMock.mockClear();
  });

  it("saves a new limit", async () => {
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={null} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    const input = await screen.findByLabelText("WIP limit");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(setStatusWipLimitMock).toHaveBeenCalledTimes(1);
    const formData = setStatusWipLimitMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("setStatusWipLimit was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("status_id")).toBe("s1");
    expect(formData.get("wip_limit")).toBe("5");
  });

  it("shows a Clear button only when a limit is already set, and clearing sends an empty value", async () => {
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={3} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    await screen.findByLabelText("WIP limit");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(setStatusWipLimitMock).toHaveBeenCalledTimes(1);
    const formData = setStatusWipLimitMock.mock.calls[0]?.[0];
    expect(formData?.get("wip_limit")).toBe("");
  });

  it("does not show a Clear button when no limit is set", async () => {
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={null} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));
    await screen.findByLabelText("WIP limit");
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("shows an error and keeps the menu open when saving fails", async () => {
    // A value that passes the input's own min=1 constraint (jsdom enforces
    // HTML5 validation and silently blocks submission otherwise) — the
    // rejection this asserts on is a server-side failure, not a client
    // validation error.
    setStatusWipLimitMock.mockRejectedValueOnce(new Error("Failed to update WIP limit"));
    render(<WipLimitMenu projectId="p1" statusId="s1" currentLimit={null} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    const input = await screen.findByLabelText("WIP limit");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update WIP limit");
  });
});

// TASK-16.3 AC #2/#3/#5: lane rendering and cross-band drag.
describe("FreeBoard lanes", () => {
  const statuses: CustomStatus[] = [
    { id: "st1", name: "To do", color: "#111111", position: 0, is_done: false, wip_limit: null },
  ];
  const lanes: Swimlane[] = [{ id: "lane1", name: "Backend", position: 0 }];

  function story(id: string, title: string, swimlaneId: string | null) {
    return {
      id,
      number: 1,
      title,
      description: null,
      story_type: "feature" as const,
      state: "unstarted" as const,
      points: null,
      assigneeName: null,
      labels: [],
      completed_at: null,
      swimlane_id: swimlaneId,
    };
  }

  beforeEach(() => {
    dropStoryFreeMock.mockClear();
  });

  it("renders the single-band board unchanged when there are no lanes", () => {
    render(
      <FreeBoard
        projectId="p1"
        statuses={statuses}
        lanes={[]}
        initialContainers={{ st1: [story("s1", "Solo card", null)] }}
      />,
    );

    expect(screen.queryByText("No lane")).not.toBeInTheDocument();
    expect(screen.getByText("Solo card")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add story" })).toHaveLength(1);
  });

  it("shows the No lane band first, and puts the quick-add composer only there", () => {
    render(
      <FreeBoard
        projectId="p1"
        statuses={statuses}
        lanes={lanes}
        initialContainers={{
          "st1::none": [story("s1", "Unassigned card", null)],
          "st1::lane1": [story("s2", "Backend card", "lane1")],
        }}
      />,
    );

    const bandLabels = screen.getAllByText(/^(No lane|Backend)$/).map((el) => el.textContent);
    expect(bandLabels).toEqual(["No lane", "Backend"]);
    // One column x one lane-band-with-composer = exactly one composer, even
    // though there are two bands (No lane + Backend) for this one column.
    expect(screen.getAllByRole("button", { name: "Add story" })).toHaveLength(1);
  });

  it("places each story in its own lane band", () => {
    render(
      <FreeBoard
        projectId="p1"
        statuses={statuses}
        lanes={lanes}
        initialContainers={{
          "st1::none": [story("s1", "Unassigned card", null)],
          "st1::lane1": [story("s2", "Backend card", "lane1")],
        }}
      />,
    );

    const noLaneBand = screen.getByText("No lane").closest<HTMLElement>("div.mt-3");
    const backendBand = screen.getByText("Backend").closest<HTMLElement>("div.mt-3");
    if (!noLaneBand || !backendBand) {
      throw new Error("lane bands not found");
    }
    expect(within(noLaneBand).getByText("Unassigned card")).toBeInTheDocument();
    expect(within(noLaneBand).queryByText("Backend card")).not.toBeInTheDocument();
    expect(within(backendBand).getByText("Backend card")).toBeInTheDocument();
    expect(within(backendBand).queryByText("Unassigned card")).not.toBeInTheDocument();
  });

  it("still shows the No lane band as a drop target when it has no cards", () => {
    render(
      <FreeBoard
        projectId="p1"
        statuses={statuses}
        lanes={lanes}
        initialContainers={{ "st1::none": [], "st1::lane1": [story("s2", "Backend card", "lane1")] }}
      />,
    );

    expect(screen.getByText("No lane")).toBeInTheDocument();
  });
});
