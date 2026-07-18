← [SPEC.md](../SPEC.md)

## Glossary

| Term | Definition |
|---|---|
| Story | The smallest unit of development work. One of: feature, bug, chore, release |
| State | A per-project board column (`project_states`). Freely named/added/removed/reordered; each state carries a fixed system **category** |
| Category | The system semantics behind a state: `unstarted` (backlog-planning zone), `in_progress`, `done` (counts for velocity, sets `completed_at`), or `rejected` (optional bounce). Immutable once a state is created |
| Icebox | Holding area for unscheduled/unprioritized stories — a story with `state_id IS NULL`. New stories start here and are triaged into the Backlog. Not a category or a state row |
| Backlog | Prioritized list of stories not yet assigned to an iteration (`iteration_id IS NULL AND state_id IS NOT NULL`) |
| Iteration | A fixed-cadence sprint (`start_date + length`). Start dates never move automatically. Display term is per-project configurable ("Sprint", "Iteration", …) |
| Cadence | The project's fixed sprint length (1 day, 1w, 2w, …), never mixed within a project. A 1-day project is an ordinary project, not a special "personal mode" |
| Working-day calendar | Per-project default working weekdays plus date exceptions (holiday / extra workday), layered with per-user time off. Affects velocity/planning math only, never sprint boundaries (single exception: 1-day cadence start-date selection) |
| Capacity | Σ over members of their working days in a sprint (calendar-aware, minus personal time off). Snapshotted onto `iterations.capacity` at finalization |
| Rollover | Lazy finalization of an iteration when its end date passes: capacity/velocity are snapshotted and stories not in a done-category state move to the next iteration |
| Velocity | Person-day rate: Σ done-category points ÷ Σ capacity over the last N non-skipped, capacity>0 done iterations (see spec/velocity.md) |
| Epic | A large feature grouping that spans multiple stories |
| Points | A numeric estimate of a story's scope, chosen from the project's point scale |
| Virtual iteration | A future iteration shown as a numbered backlog group — computed from velocity × planned capacity at render time, no DB row |
| Story pin | A per-user mark (`story_pins`) that surfaces a longer-cadence project's story in today's My Work bucket |
| My Work | Cross-project personal view of all stories assigned to the signed-in user (replaces the per-project Focus view) |
| Agent member | An ordinary project member flagged `profiles.is_agent = true` so UIs can tell coding agents apart from humans |
