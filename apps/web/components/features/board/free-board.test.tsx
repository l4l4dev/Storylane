import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardPermissionsProvider, ColumnMenu, FreeBoard, type CustomStatus, type Swimlane } from "./free-board";

const { setStatusWipLimitMock, createCustomStatusMock, updateCustomStatusMock, deleteCustomStatusMock } = vi.hoisted(() => ({
  setStatusWipLimitMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  createCustomStatusMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  updateCustomStatusMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  deleteCustomStatusMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/settings/actions", () => ({
  setStatusWipLimit: setStatusWipLimitMock,
  createCustomStatus: createCustomStatusMock,
  updateCustomStatus: updateCustomStatusMock,
  deleteCustomStatus: deleteCustomStatusMock,
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

describe("ColumnMenu", () => {
  const status: CustomStatus = { id: "s1", name: "To do", color: "#111111", position: 0, is_done: false, wip_limit: null };

  function columnMenu(canEdit: boolean, canDelete: boolean, value = status) {
    return (
      <BoardPermissionsProvider permissions={{ canEdit, canDelete }}>
        <ColumnMenu projectId="p1" status={value} />
      </BoardPermissionsProvider>
    );
  }

  beforeEach(() => {
    setStatusWipLimitMock.mockClear();
    updateCustomStatusMock.mockClear();
    deleteCustomStatusMock.mockClear();
  });

  it("renders nothing for a viewer (canEdit false)", () => {
    render(columnMenu(false, false));
    expect(screen.queryByRole("button", { name: "Column options" })).not.toBeInTheDocument();
  });

  it("saves a new WIP limit", async () => {
    render(columnMenu(true, false));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    const input = await screen.findByLabelText("WIP limit");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));

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
    render(columnMenu(true, false, { ...status, wip_limit: 3 }));
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
    render(columnMenu(true, false));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));
    await screen.findByLabelText("WIP limit");
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("shows an error and keeps the menu open when saving the limit fails", async () => {
    // A value that passes the input's own min=1 constraint (jsdom enforces
    // HTML5 validation and silently blocks submission otherwise) — the
    // rejection this asserts on is a server-side failure, not a client
    // validation error.
    setStatusWipLimitMock.mockRejectedValueOnce(new Error("Failed to update WIP limit"));
    render(columnMenu(true, false));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    const input = await screen.findByLabelText("WIP limit");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update WIP limit");
  });

  it("saves color and done-column changes, preserving the current name", async () => {
    render(columnMenu(true, false));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));

    fireEvent.change(await screen.findByLabelText("Column color"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByLabelText("Done column"));
    fireEvent.click(screen.getByRole("button", { name: "Save column" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(updateCustomStatusMock).toHaveBeenCalledTimes(1);
    const formData = updateCustomStatusMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("updateCustomStatus was not called with FormData");
    }
    expect(formData.get("status_id")).toBe("s1");
    expect(formData.get("name")).toBe("To do");
    expect(formData.get("color")).toBe("#00ff00");
    expect(formData.get("is_done")).toBe("on");
  });

  it("hides Delete column for a member and shows it for an owner", async () => {
    const { rerender } = render(columnMenu(true, false));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Column options" }));
    await screen.findByLabelText("WIP limit");
    expect(screen.queryByRole("button", { name: "Delete column" })).not.toBeInTheDocument();

    rerender(columnMenu(true, true));
    fireEvent.click(screen.getByRole("button", { name: "Delete column" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(deleteCustomStatusMock).toHaveBeenCalledTimes(1);
    const formData = deleteCustomStatusMock.mock.calls[0]?.[0];
    expect(formData?.get("status_id")).toBe("s1");
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
      epic: null,
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

// TASK-44 AC #1/#2/#4: add and rename columns from the board itself.
describe("FreeBoard column management", () => {
  const statuses: CustomStatus[] = [
    { id: "st1", name: "To do", color: "#111111", position: 0, is_done: false, wip_limit: null },
  ];

  beforeEach(() => {
    createCustomStatusMock.mockClear();
    updateCustomStatusMock.mockClear();
  });

  it("does not show Add column or inline rename for a viewer", () => {
    render(<FreeBoard projectId="p1" statuses={statuses} lanes={[]} initialContainers={{ st1: [] }} canEdit={false} />);

    expect(screen.queryByRole("button", { name: "+ Add column" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "To do" })).not.toBeInTheDocument();
    expect(screen.getByText("To do")).toBeInTheDocument();
  });

  it("creates a column from the board", async () => {
    render(<FreeBoard projectId="p1" statuses={statuses} lanes={[]} initialContainers={{ st1: [] }} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add column" }));
    const input = screen.getByPlaceholderText("Column name");
    fireEvent.change(input, { target: { value: "Blocked" } });
    fireEvent.blur(input);

    await act(async () => {
      await Promise.resolve();
    });
    expect(createCustomStatusMock).toHaveBeenCalledTimes(1);
    const formData = createCustomStatusMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("createCustomStatus was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("name")).toBe("Blocked");
  });

  it("discards an empty column name on blur without calling createCustomStatus", () => {
    render(<FreeBoard projectId="p1" statuses={statuses} lanes={[]} initialContainers={{ st1: [] }} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add column" }));
    fireEvent.blur(screen.getByPlaceholderText("Column name"));

    expect(createCustomStatusMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Column name")).not.toBeInTheDocument();
  });

  it("renames a column inline, preserving its color and is_done", async () => {
    render(<FreeBoard projectId="p1" statuses={statuses} lanes={[]} initialContainers={{ st1: [] }} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "To do" }));
    const input = screen.getByLabelText("Rename To do");
    fireEvent.change(input, { target: { value: "Doing" } });
    fireEvent.blur(input);

    await act(async () => {
      await Promise.resolve();
    });
    expect(updateCustomStatusMock).toHaveBeenCalledTimes(1);
    const formData = updateCustomStatusMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("updateCustomStatus was not called with FormData");
    }
    expect(formData.get("status_id")).toBe("st1");
    expect(formData.get("name")).toBe("Doing");
    expect(formData.get("color")).toBe("#111111");
    expect(formData.get("is_done")).toBeNull();
  });

  it("cancels an inline rename on Escape without calling updateCustomStatus", () => {
    render(<FreeBoard projectId="p1" statuses={statuses} lanes={[]} initialContainers={{ st1: [] }} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "To do" }));
    const input = screen.getByLabelText("Rename To do");
    fireEvent.change(input, { target: { value: "Doing" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(updateCustomStatusMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "To do" })).toBeInTheDocument();
  });
});
