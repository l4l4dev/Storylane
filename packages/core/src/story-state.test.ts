import { describe, expect, it } from "vitest";
import { computeStateGate, shouldAssignCurrentIteration, type GateState, type StateGate } from "./story-state";
import stateTemplates from "../../../spec/fixtures/state-templates.json";

type FixtureState = { name: string; category: GateState["category"]; position: number; actionLabel: string | null };
type FixtureGate = { current: string; expected: Record<string, unknown> & { kind: string } };
type Fixture = { states: FixtureState[]; gates: FixtureGate[] };

const fixtures = stateTemplates as unknown as { classic: Fixture; minimal: Fixture };

// Fixture states are keyed by name (ids are runtime UUIDs); this test
// synthesizes stable ids by reusing the name, and resolves each fixture
// gate's target names back to those same ids for comparison.
function toGateStates(fixture: Fixture): GateState[] {
  return fixture.states.map((s) => ({ id: s.name, category: s.category, actionLabel: s.actionLabel, position: s.position }));
}

function resolveExpectedGate(expected: FixtureGate["expected"]): StateGate {
  return expected as StateGate; // target*Id fields already hold state names, matching the synthesized ids above.
}

describe.each([
  ["classic", fixtures.classic],
  ["minimal", fixtures.minimal],
])("computeStateGate — %s template golden fixture", (_label, fixture) => {
  const states = toGateStates(fixture);

  it.each(fixture.gates)("$current -> $expected.kind", ({ current, expected }) => {
    expect(computeStateGate(states, current)).toEqual(resolveExpectedGate(expected));
  });
});

describe("computeStateGate", () => {
  const classic = toGateStates(fixtures.classic);

  it("returns none for the Icebox (state_id null) — promotion is drag-and-drop only", () => {
    expect(computeStateGate(classic, null)).toEqual({ kind: "none" });
  });

  it("returns none for an unknown state id (defensive)", () => {
    expect(computeStateGate(classic, "not-a-real-state")).toEqual({ kind: "none" });
  });

  it("omits reject when the project has no rejected-category state", () => {
    const noRejected = classic.filter((s) => s.category !== "rejected");
    expect(computeStateGate(noRejected, "Delivered")).toEqual({
      kind: "accept-reject",
      acceptLabel: "Accept",
      acceptStateId: "Accepted",
      rejectStateId: null,
    });
  });

  it("omits the restart target when the project has no in_progress-category state", () => {
    const noInProgress = classic.filter((s) => s.category !== "in_progress");
    expect(computeStateGate(noInProgress, "Rejected")).toEqual({ kind: "restart", targetStateId: null });
  });

  it("shows no button on a state with a null action_label even when a next state exists", () => {
    const states: GateState[] = [
      { id: "a", category: "unstarted", actionLabel: null, position: 0 },
      { id: "b", category: "in_progress", actionLabel: "Go", position: 1 },
    ];
    expect(computeStateGate(states, "a")).toEqual({ kind: "none" });
  });

  it("returns none for the last state in position order (nothing to advance to)", () => {
    const states: GateState[] = [{ id: "only", category: "unstarted", actionLabel: "Start", position: 0 }];
    expect(computeStateGate(states, "only")).toEqual({ kind: "none" });
  });

  it("shows no button when a rejected-category state is positioned as the very next state (not paired with a preceding done)", () => {
    const states: GateState[] = [
      { id: "a", category: "unstarted", actionLabel: "Start", position: 0 },
      { id: "rejected", category: "rejected", actionLabel: null, position: 1 },
    ];
    // A plain advance must never silently land a story in a rejected state
    // under the "Start" label — only the synthesized Reject half of an
    // Accept/Reject pair may target a rejected-category state.
    expect(computeStateGate(states, "a")).toEqual({ kind: "none" });
  });

  it("generalizes to a fully custom project with multiple unstarted-category states", () => {
    const states: GateState[] = [
      { id: "todo", category: "unstarted", actionLabel: "Triage", position: 0 },
      { id: "triaged", category: "unstarted", actionLabel: "Start", position: 1 },
      { id: "doing", category: "in_progress", actionLabel: "Done", position: 2 },
      { id: "done", category: "done", actionLabel: null, position: 3 },
    ];
    expect(computeStateGate(states, "todo")).toEqual({ kind: "advance", label: "Triage", targetStateId: "triaged" });
  });
});

describe("shouldAssignCurrentIteration", () => {
  it("is true when entering an in_progress-category state with no iteration yet", () => {
    expect(shouldAssignCurrentIteration("in_progress", false)).toBe(true);
  });

  it("is false when the story already has an iteration", () => {
    expect(shouldAssignCurrentIteration("in_progress", true)).toBe(false);
  });

  it("is false for any target category other than in_progress", () => {
    expect(shouldAssignCurrentIteration("unstarted", false)).toBe(false);
    expect(shouldAssignCurrentIteration("done", false)).toBe(false);
    expect(shouldAssignCurrentIteration("rejected", false)).toBe(false);
  });
});
