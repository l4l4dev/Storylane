import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult, ProjectState } from "@/lib/types";
import { BoardListView, DividerRow, InsertBetweenRows, IterationGoalInput, IterationHeaderRow, RowInsertMenu } from "./board-list-view";
import type { BoardStory } from "./kanban-board";

const { deleteBacklogDividerMock, createBacklogDividerMock, quickCreateStoryMock, upsertIterationGoalMock } = vi.hoisted(() => ({
  deleteBacklogDividerMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  createBacklogDividerMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  quickCreateStoryMock: vi.fn<(formData: FormData) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
  upsertIterationGoalMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  createBacklogDivider: createBacklogDividerMock,
  deleteBacklogDivider: deleteBacklogDividerMock,
  dropStoryInList: vi.fn(),
  estimateStory: vi.fn(),
  quickCreateStory: quickCreateStoryMock,
  setStoryState: vi.fn(),
  upsertIterationGoal: upsertIterationGoalMock,
}));

describe("IterationGoalInput", () => {
  beforeEach(() => {
    upsertIterationGoalMock.mockClear();
    upsertIterationGoalMock.mockResolvedValue(undefined);
  });

  it("renders saved or ghost text with a persistent edit affordance by default", () => {
    const { unmount } = render(<IterationGoalInput projectId="p1" number={4} initialGoal="Ship it" />);
    expect(screen.queryByRole("textbox", { name: "Iteration #4 goal" })).not.toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Edit iteration #4 goal: Ship it" });
    expect(editButton).toHaveTextContent("Ship it");
    expect(editButton.querySelector("svg")).toHaveClass("opacity-60");
    unmount();

    render(<IterationGoalInput projectId="p1" number={4} initialGoal="" />);
    expect(screen.getByRole("button", { name: "Add iteration #4 goal" })).toHaveTextContent("Add goal…");
  });

  it("opens on click, commits on Enter, and returns to text", async () => {
    render(<IterationGoalInput projectId="p1" number={4} initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(upsertIterationGoalMock).toHaveBeenCalledTimes(1);
    const formData = upsertIterationGoalMock.mock.calls[0]?.[0];
    expect(formData?.get("project_id")).toBe("p1");
    expect(formData?.get("number")).toBe("4");
    expect(formData?.get("goal")).toBe("Ship it");
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("textbox", { name: "Iteration #4 goal" })).not.toBeInTheDocument();
  });

  it("commits on blur", async () => {
    render(<IterationGoalInput projectId="p1" number={4} initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.blur(input);
    await act(async () => {
      await Promise.resolve();
    });
    expect(upsertIterationGoalMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox", { name: "Iteration #4 goal" })).not.toBeInTheDocument();
  });

  it("discards on Escape without saving", () => {
    render(<IterationGoalInput projectId="p1" number={4} initialGoal="Original" />);
    fireEvent.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(upsertIterationGoalMock).not.toHaveBeenCalled();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("ignores Enter and Escape while IME composition is active", () => {
    render(<IterationGoalInput projectId="p1" number={4} initialGoal="Original" />);
    fireEvent.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "変換中" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(upsertIterationGoalMock).not.toHaveBeenCalled();
    expect(input).toHaveValue("変換中");
  });

  it("keeps the editor and typed value when saving fails", async () => {
    upsertIterationGoalMock.mockRejectedValueOnce(new Error("Not a member"));
    render(<IterationGoalInput projectId="p1" number={4} initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("textbox", { name: "Iteration #4 goal" })).toHaveValue("Ship it");
    expect(screen.getByText("Not a member")).toBeInTheDocument();
  });

  it("does not double-submit or lose a failure during an overlapping blur", async () => {
    let rejectSave: ((reason: Error) => void) | undefined;
    upsertIterationGoalMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    render(<IterationGoalInput projectId="p1" number={4} initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(upsertIterationGoalMock).toHaveBeenCalledTimes(1);

    rejectSave?.(new Error("Winning failure"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(upsertIterationGoalMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Iteration #4 goal" })).toHaveValue("Ship it");
    expect(screen.getByText("Winning failure")).toBeInTheDocument();
  });

  it("restores focus after a successful save and after Escape", async () => {
    const { unmount } = render(<IterationGoalInput projectId="p1" number={4} initialGoal="" />);
    fireEvent.click(screen.getByText("Add goal…"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /Edit iteration #4 goal/ })).toHaveFocus();
    unmount();

    render(<IterationGoalInput projectId="p1" number={4} initialGoal="Original" />);
    fireEvent.click(screen.getByText("Original"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Iteration #4 goal" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: /Edit iteration #4 goal/ })).toHaveFocus();
  });

  it("preserves a draft across a prop change and uses the new server value on Escape", () => {
    const { rerender } = render(<IterationGoalInput projectId="p1" number={4} initialGoal="Original" />);
    fireEvent.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Local draft" } });

    rerender(<IterationGoalInput projectId="p1" number={4} initialGoal="External update" />);

    expect(screen.getByRole("textbox", { name: "Iteration #4 goal" })).toHaveValue("Local draft");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Iteration #4 goal" }), { key: "Escape" });
    expect(screen.getByText("External update")).toBeInTheDocument();
  });

  it("does not let a prop change during an in-flight save clobber the save outcome", async () => {
    let resolveSave: (() => void) | undefined;
    upsertIterationGoalMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { rerender } = render(<IterationGoalInput projectId="p1" number={4} initialGoal="Original" />);
    fireEvent.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Local save" } });
    fireEvent.keyDown(input, { key: "Enter" });

    rerender(<IterationGoalInput projectId="p1" number={4} initialGoal="External update" />);
    expect(screen.getByRole("textbox", { name: "Iteration #4 goal" })).toHaveValue("Local save");

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
    expect(screen.getByText("Local save")).toBeInTheDocument();
    expect(screen.queryByText("External update")).not.toBeInTheDocument();
  });

  it("does not restore focus after a deferred blur save", async () => {
    let resolveSave: (() => void) | undefined;
    upsertIterationGoalMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <>
        <IterationGoalInput projectId="p1" number={4} initialGoal="Original" />
        <button type="button">Other control</button>
      </>,
    );
    fireEvent.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: "Iteration #4 goal" });
    fireEvent.change(input, { target: { value: "Blur save" } });
    fireEvent.blur(input);
    screen.getByRole("button", { name: "Other control" }).focus();

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Other control" })).toHaveFocus();
  });
});

function backlogStory(id: string, points: number): BoardStory {
  return {
    id,
    number: Number(id.slice(1)),
    title: `Story ${id}`,
    description: null,
    story_type: "feature",
    isDone: false,
    state_id: null,
    points,
    assigneeName: null,
    labels: [],
    epic: null,
    iteration_id: null,
    position: Number(id.slice(1)),
    assignee_id: null,
    labelIds: [],
    epic_id: null,
    completed_at: null,
  };
}

const CLASSIC_STATES: ProjectState[] = [
  { id: "unstarted", name: "Unstarted", category: "unstarted", action_label: "Start", position: 0, project_id: "p1", created_at: "" },
  { id: "started", name: "Started", category: "in_progress", action_label: "Finish", position: 1, project_id: "p1", created_at: "" },
  { id: "finished", name: "Finished", category: "in_progress", action_label: "Deliver", position: 2, project_id: "p1", created_at: "" },
  { id: "delivered", name: "Delivered", category: "in_progress", action_label: "Accept", position: 3, project_id: "p1", created_at: "" },
  { id: "accepted", name: "Accepted", category: "done", action_label: null, position: 4, project_id: "p1", created_at: "" },
  { id: "rejected", name: "Rejected", category: "rejected", action_label: null, position: 5, project_id: "p1", created_at: "" },
];

function boardProps(stories: BoardStory[]) {
  return {
    projectId: "p1",
    currentIteration: null,
    states: CLASSIC_STATES,
    initialContainers: {
      backlog: [],
      icebox: [],
      unstarted: [],
      started: [],
      finished: [],
      delivered: [],
      accepted: [],
      rejected: [],
    },
    initialBacklogItems: stories.map((story) => ({ kind: "story" as const, story })),
    backlogBudgets: [5],
    nextVirtualIterationNumber: 4,
    iterationLength: 14,
    iterationGoals: {},
    showIcebox: false,
    filter: {},
    pointScale: [0, 1, 2, 3, 5, 8, 13],
  };
}

describe("Backlog per-group quick add", () => {
  const s1 = backlogStory("s1", 3);
  const s2 = backlogStory("s2", 2);
  const s3 = backlogStory("s3", 3);

  beforeEach(() => {
    quickCreateStoryMock.mockClear();
    quickCreateStoryMock.mockResolvedValue({ ok: true });
  });

  it("preserves an open composer's typed title when Realtime changes which row ends its group", () => {
    const { rerender } = render(<BoardListView {...boardProps([s1, s2, s3])} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Add story" })[1]!);
    fireEvent.change(screen.getByRole("textbox", { name: "New story title" }), {
      target: { value: "Still drafting" },
    });

    // Group #4 remains, but its bottom changes from s2 to s3.
    rerender(<BoardListView {...boardProps([s2, s3, s1])} />);

    expect(screen.getByRole("textbox", { name: "New story title" })).toHaveValue("Still drafting");
  });

  it("still inserts immediately before the first row of the following group", async () => {
    render(<BoardListView {...boardProps([s1, s2, s3])} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Add story" })[1]!);
    const input = screen.getByRole("textbox", { name: "New story title" });
    fireEvent.change(input, { target: { value: "At group bottom" } });
    fireEvent.submit(input.closest("form")!);

    await act(async () => {
      await Promise.resolve();
    });
    const formData = quickCreateStoryMock.mock.calls[0]?.[0];
    expect(formData?.get("target")).toBe("backlog");
    expect(formData?.get("before_item_id")).toBe("story:s3");
  });
});

describe("IterationHeaderRow", () => {
  beforeEach(() => {
    deleteBacklogDividerMock.mockClear();
  });

  function baseProps() {
    return {
      number: 4,
      points: 3,
      projectId: "p1",
      goal: "",
      projectedDates: null,
      collapsed: false,
      onToggle: vi.fn(),
    };
  }

  it("shows no manual-break badge for a header from an automatic capacity split", () => {
    render(<IterationHeaderRow {...baseProps()} />);
    expect(screen.queryByText("manual")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove manual iteration break" })).not.toBeInTheDocument();
  });

  it("shows a removable manual badge for a header a break forced, with no separate divider row", () => {
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove manual iteration break" })).toBeInTheDocument();
    // The old standalone divider row's label must not appear anywhere here.
    expect(screen.queryByText("Iteration break")).not.toBeInTheDocument();
  });

  it("deletes the correct divider when the badge's remove button is clicked", async () => {
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove manual iteration break" }));
    expect(deleteBacklogDividerMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Remove manual iteration break?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove break" }));

    expect(deleteBacklogDividerMock).toHaveBeenCalledTimes(1);
    const formData = deleteBacklogDividerMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("deleteBacklogDivider was not called with FormData");
    }
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("divider_id")).toBe("div-1");

    await act(async () => {
      await Promise.resolve();
    });
  });

  it("shows an error and keeps the badge when removal fails, instead of failing silently", async () => {
    deleteBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove manual iteration break" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove break" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Not a member of this project");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Remove manual iteration break" })).toBeInTheDocument();
  });

  it("reopens the manual-break confirmation without a stale error and marks confirm destructive", async () => {
    deleteBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove manual iteration break" }));
    const firstConfirm = screen.getByRole("button", { name: "Remove break" });
    expect(firstConfirm).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(firstConfirm);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Not a member of this project");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove manual iteration break" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove break" })).toHaveAttribute("data-variant", "destructive");
  });

  it("keeps the manual-break dialog open when dismissal is attempted during a deferred failure", async () => {
    let rejectDelete: ((reason: Error) => void) | undefined;
    deleteBacklogDividerMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDelete = reject;
        }),
    );
    render(<IterationHeaderRow {...baseProps()} manualBreakDividerId="div-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove manual iteration break" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove break" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await act(async () => {
      rejectDelete?.(new Error("Deferred break failure"));
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog", { name: "Remove manual iteration break?" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Deferred break failure");
  });
});

// TASK-42: the row "…" menu is the primary way to insert a note or
// iteration break at a chosen position — replacing pixel-hunting the
// hover-line's thin gap (kept as a secondary shortcut, unaffected here).
describe("RowInsertMenu", () => {
  const onError = vi.fn();

  beforeEach(() => {
    createBacklogDividerMock.mockClear();
    onError.mockClear();
  });

  function lastCallFormData() {
    const formData = createBacklogDividerMock.mock.calls[0]?.[0];
    if (!formData) {
      throw new Error("createBacklogDivider was not called with FormData");
    }
    return formData;
  }

  // "Top": aboveId anchors to the very first row.
  it("inserts an iteration break above (top position)", async () => {
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:first" belowId="story:second" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert iteration break above" }));

    expect(createBacklogDividerMock).toHaveBeenCalledTimes(1);
    const formData = lastCallFormData();
    expect(formData.get("project_id")).toBe("p1");
    expect(formData.get("kind")).toBe("iteration_break");
    expect(formData.get("before_item_id")).toBe("story:first");
  });

  // "Middle": belowId anchors to a real next row, not the end of the list.
  it("inserts a note below (middle position) via the label dialog", async () => {
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:mid" belowId="story:next" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert note below" }));

    const input = screen.getByRole("textbox", { name: "New note label" });
    fireEvent.change(input, { target: { value: "Phase 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(createBacklogDividerMock).toHaveBeenCalledTimes(1);
    const formData = lastCallFormData();
    expect(formData.get("kind")).toBe("note");
    expect(formData.get("label")).toBe("Phase 2");
    expect(formData.get("before_item_id")).toBe("story:next");
    expect(screen.queryByRole("textbox", { name: "New note label" })).not.toBeInTheDocument();
  });

  // "Bottom": belowId is null at the very last row — no before_item_id
  // means append at the absolute end (same convention as InsertBetweenRows).
  it("inserts an iteration break below with no before_item_id at the bottom position", async () => {
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:last" belowId={null} onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert iteration break below" }));

    const formData = lastCallFormData();
    expect(formData.get("kind")).toBe("iteration_break");
    expect(formData.get("before_item_id")).toBeNull();
  });

  it("shows an error and keeps the dialog open when inserting a note fails", async () => {
    createBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:a" belowId="story:b" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert note above" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New note label" }), { target: { value: "Oops" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Not a member of this project");
    expect(screen.getByRole("textbox", { name: "New note label" })).toHaveValue("Oops");
  });

  // Unlike the note dialog (which has its own inline alert), an iteration
  // break has no per-row slot to show a failure without shifting layout —
  // it must report to the shared banner via onError instead of failing
  // silently (spec/ux-principles.md principle 2).
  it("reports a failed iteration break insert via onError instead of failing silently", async () => {
    createBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    const user = userEvent.setup();
    render(<RowInsertMenu projectId="p1" aboveId="story:a" belowId="story:b" onError={onError} />);

    await user.click(screen.getByRole("button", { name: "Insert note or iteration break" }));
    await user.click(screen.getByRole("menuitem", { name: "Insert iteration break below" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith("Not a member of this project");
  });
});

// TASK-60: DividerRow's delete used to be a fire-and-forget `void` call —
// a rejected delete left the row on screen with no explanation.
describe("DividerRow", () => {
  const onError = vi.fn();

  beforeEach(() => {
    deleteBacklogDividerMock.mockClear();
    deleteBacklogDividerMock.mockResolvedValue(undefined);
    onError.mockClear();
  });

  function divider() {
    return { id: "d1", label: "Phase 2", kind: "note" as const };
  }

  it("confirms before deleting the divider and reports nothing on success", async () => {
    render(<DividerRow projectId="p1" divider={divider()} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: 'Remove "Phase 2"' }));
    expect(deleteBacklogDividerMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: 'Remove note "Phase 2"?' })).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Remove note" });
    expect(confirmButton).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(confirmButton);

    await act(async () => {
      await Promise.resolve();
    });
    expect(deleteBacklogDividerMock).toHaveBeenCalledTimes(1);
    const formData = deleteBacklogDividerMock.mock.calls[0]?.[0];
    expect(formData?.get("project_id")).toBe("p1");
    expect(formData?.get("divider_id")).toBe("d1");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a failed delete via onError instead of failing silently", async () => {
    deleteBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<DividerRow projectId="p1" divider={divider()} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: 'Remove "Phase 2"' }));
    fireEvent.click(screen.getByRole("button", { name: "Remove note" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith("Not a member of this project");
  });

  it("keeps the note dialog open when dismissal is attempted during a deferred failure", async () => {
    let rejectDelete: ((reason: Error) => void) | undefined;
    deleteBacklogDividerMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDelete = reject;
        }),
    );
    render(<DividerRow projectId="p1" divider={divider()} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: 'Remove "Phase 2"' }));
    fireEvent.click(screen.getByRole("button", { name: "Remove note" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await act(async () => {
      rejectDelete?.(new Error("Deferred note failure"));
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog", { name: 'Remove note "Phase 2"?' })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Deferred note failure");
  });
});

// TASK-60: the hover insert-between affordance's note/break actions used to
// be fire-and-forget `void` calls — a rejected insert silently did nothing,
// and a failed note submission had already cleared the typed text.
describe("InsertBetweenRows", () => {
  const onError = vi.fn();

  beforeEach(() => {
    createBacklogDividerMock.mockClear();
    createBacklogDividerMock.mockResolvedValue(undefined);
    onError.mockClear();
  });

  it("clears the input and closes on a successful note insert", async () => {
    render(<InsertBetweenRows projectId="p1" beforeItemId="story:next" onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Note" }));
    const input = screen.getByRole("textbox", { name: "New divider label" });
    fireEvent.change(input, { target: { value: "Phase 2" } });
    fireEvent.submit(input.closest("form")!);

    await act(async () => {
      await Promise.resolve();
    });
    const formData = createBacklogDividerMock.mock.calls[0]?.[0];
    expect(formData?.get("kind")).toBe("note");
    expect(formData?.get("label")).toBe("Phase 2");
    expect(formData?.get("before_item_id")).toBe("story:next");
    expect(screen.queryByRole("textbox", { name: "New divider label" })).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the typed label and reports via onError when the note insert fails", async () => {
    createBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<InsertBetweenRows projectId="p1" beforeItemId="story:next" onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Note" }));
    const input = screen.getByRole("textbox", { name: "New divider label" });
    fireEvent.change(input, { target: { value: "Phase 2" } });
    fireEvent.submit(input.closest("form")!);

    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith("Not a member of this project");
    expect(screen.getByRole("textbox", { name: "New divider label" })).toHaveValue("Phase 2");
  });

  it("inserts an iteration break at the given position", async () => {
    render(<InsertBetweenRows projectId="p1" beforeItemId="story:next" onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Iteration break" }));

    await act(async () => {
      await Promise.resolve();
    });
    const formData = createBacklogDividerMock.mock.calls[0]?.[0];
    expect(formData?.get("kind")).toBe("iteration_break");
    expect(formData?.get("before_item_id")).toBe("story:next");
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a failed iteration break insert via onError instead of failing silently", async () => {
    createBacklogDividerMock.mockRejectedValueOnce(new Error("Not a member of this project"));
    render(<InsertBetweenRows projectId="p1" beforeItemId="story:next" onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Iteration break" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith("Not a member of this project");
  });
});
