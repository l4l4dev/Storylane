import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KanbanColumn } from "./kanban-columns-board";
import type { ProjectState } from "@/lib/types";

const doneState: ProjectState = {
  id: "s1",
  name: "Accepted",
  category: "done",
  action_label: null,
  position: 0,
  project_id: "p1",
  created_at: "",
};

const inProgressState: ProjectState = {
  ...doneState,
  id: "s2",
  name: "Started",
  category: "in_progress",
};

describe("KanbanColumn", () => {
  // TASK-206: the info icon belongs on a done-category column's header only
  // — the drag-only Kanban path has no TransitionButtons to attach it to.
  it("shows the Definition of Done icon on a done-category column when the project has one set", () => {
    render(
      <KanbanColumn projectId="p1" state={doneState} states={[doneState]} stories={[]} canManageStates={false} doneDefinition="Tests pass.">
        <div />
      </KanbanColumn>,
    );
    expect(screen.getByRole("button", { name: "Definition of Done" })).toBeInTheDocument();
  });

  it("renders no icon when the project has no Definition of Done set", () => {
    render(
      <KanbanColumn projectId="p1" state={doneState} states={[doneState]} stories={[]} canManageStates={false} doneDefinition={null}>
        <div />
      </KanbanColumn>,
    );
    expect(screen.queryByRole("button", { name: "Definition of Done" })).not.toBeInTheDocument();
  });

  it("renders no icon on a non-done-category column even when the project has one set", () => {
    render(
      <KanbanColumn projectId="p1" state={inProgressState} states={[inProgressState]} stories={[]} canManageStates={false} doneDefinition="Tests pass.">
        <div />
      </KanbanColumn>,
    );
    expect(screen.queryByRole("button", { name: "Definition of Done" })).not.toBeInTheDocument();
  });
});
