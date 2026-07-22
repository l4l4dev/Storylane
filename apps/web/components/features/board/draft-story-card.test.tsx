import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/types";
import { DraftStoryCard, DraftStoryTrigger } from "./draft-story-card";

const { createDraftStoryMock } = vi.hoisted(() => ({
  createDraftStoryMock: vi.fn<(input: unknown) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  createDraftStory: createDraftStoryMock,
}));

const EPICS = [{ id: "epic-1", name: "Checkout revamp" }];
const MEMBERS = [{ id: "user-1", name: "Mary Evans" }];
const LABELS = [{ id: "label-1", name: "Urgent" }];

function renderCard(overrides: Partial<Parameters<typeof DraftStoryCard>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <DraftStoryCard
      projectId="p1"
      target="unstarted"
      beforeItemId={null}
      pointScale={[0, 1, 2, 3, 5, 8, 13]}
      epics={EPICS}
      members={MEMBERS}
      labels={LABELS}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose };
}

describe("DraftStoryTrigger", () => {
  it("renders a labeled button that calls onClick", () => {
    const onClick = vi.fn();
    render(<DraftStoryTrigger label="Add story to Current" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Add story to Current" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("DraftStoryCard", () => {
  beforeEach(() => {
    createDraftStoryMock.mockReset();
    createDraftStoryMock.mockResolvedValue({ ok: true });
  });

  it("scrolls itself into view on open — a header trigger outside the panel's own scroll area (Kanban columns, Icebox) stays clickable however far the body is scrolled, so opening the card at the body's top would otherwise land off-screen with no visible sign anything happened", () => {
    const scrollIntoViewMock = vi.fn();
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(scrollIntoViewMock);

    renderCard();

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });

    vi.restoreAllMocks();
  });

  it("shows the full field set: title, description, type, points, epic, assignee, labels", () => {
    renderCard();

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Points")).toBeInTheDocument();
    expect(screen.getByLabelText("Epic")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });

  // TASK-147: My Work's quick-add passes hidePointsAndEpic (doc-8 §10 "title
  // only, defaults for everything else") — the personal project has no epics
  // and never estimates.
  it("hides Points and Epic when hidePointsAndEpic is set, keeping the rest", () => {
    renderCard({ hidePointsAndEpic: true });

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
    expect(screen.queryByLabelText("Points")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Epic")).not.toBeInTheDocument();
  });

  // My Work's quick-add passes this (TASK-93 follow-up): a personal task left
  // unassigned would never satisfy My Work's own assignee_id = viewer query,
  // so it'd never show up anywhere the user could find it again. Board panels
  // never pass it — Pivotal parity (unassigned by default) is unaffected.
  it("defaults the assignee to defaultAssigneeId when given (My Work's quick-add)", () => {
    renderCard({ members: [{ id: "user-1", name: "Mary Evans" }], defaultAssigneeId: "user-1" });
    expect(screen.getByLabelText("Assignee")).toHaveValue("user-1");
  });

  it("defaults the assignee to unassigned when defaultAssigneeId is omitted (board panels)", () => {
    renderCard();
    expect(screen.getByLabelText("Assignee")).toHaveValue("");
  });

  it("only requires the title — Save is disabled until one is typed", () => {
    renderCard();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves the full field set and closes on success", async () => {
    const { onClose } = renderCard({ target: "backlog", beforeItemId: "story:top" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Details here" } });
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Epic"), { target: { value: "epic-1" } });
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "user-1" } });
    fireEvent.click(screen.getByText("Urgent"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createDraftStoryMock).toHaveBeenCalledWith({
      projectId: "p1",
      target: "backlog",
      view: undefined,
      beforeItemId: "story:top",
      title: "Ship it",
      description: "Details here",
      storyType: "feature",
      points: 3,
      epicId: "epic-1",
      assigneeId: "user-1",
      labelIds: ["label-1"],
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends null for a blank description rather than an empty string", async () => {
    renderCard();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await act(async () => {
      await Promise.resolve();
    });
    const call = createDraftStoryMock.mock.calls[0]?.[0] as { description: string | null };
    expect(call.description).toBeNull();
  });

  it("saves on Cmd/Ctrl+S from within a field", () => {
    renderCard();
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Ship it" } });

    fireEvent.keyDown(title, { key: "s", metaKey: true });

    expect(createDraftStoryMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft open and shows an error when the save fails", async () => {
    createDraftStoryMock.mockResolvedValueOnce({ ok: false, message: "Title required" });
    const { onClose } = renderCard();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Title required");
    expect(screen.getByLabelText("Title")).toHaveValue("Ship it");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("discards and closes on Escape without saving", () => {
    const { onClose } = renderCard();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "half-typed" } });

    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createDraftStoryMock).not.toHaveBeenCalled();
  });

  it("does not discard on Escape during an IME composition", () => {
    const { onClose } = renderCard();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "変換中" } });

    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Escape", isComposing: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on an outside click", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <DraftStoryCard
          projectId="p1"
          target="unstarted"
          beforeItemId={null}
          pointScale={[]}
          epics={[]}
          members={[]}
          labels={[]}
          onClose={onClose}
        />
      </div>,
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a click inside the card", () => {
    const { onClose } = renderCard();

    fireEvent.mouseDown(screen.getByLabelText("Title"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
