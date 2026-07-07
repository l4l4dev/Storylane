← [SPEC.md](../SPEC.md)

## Glossary

| Term | Definition |
|---|---|
| Story | The smallest unit of development work. One of: feature, bug, chore, release |
| Icebox | Holding area for unscheduled/unprioritized stories (`state = 'unscheduled'`). New stories start here and are triaged into the Backlog |
| Backlog | Prioritized list of stories not yet assigned to an iteration |
| Iteration | A sprint — a fixed development cycle of 1–4 weeks |
| Rollover | Automatic finalization of an iteration when its end date passes: velocity is stored and unaccepted stories move to the next iteration |
| Velocity | Average points completed across the last N iterations |
| Epic | A large feature grouping that spans multiple stories |
| Points | A numeric estimate of a story's scope, chosen from the project's point scale |
| Accepted | A story that has been reviewed and marked as complete |
| Tracker mode | Workflow mode with the fixed state machine, iterations, and velocity (`workflow_mode = 'tracker'`). Never called "Pivotal Tracker" in the UI |
| Free mode | Workflow mode with user-defined board columns and no iterations/velocity (`workflow_mode = 'free'`) |
| Focus view | Tracker-mode board view bucketing current-iteration stories into Todo / This week / Today / In progress / Done |
| Virtual iteration | A future iteration shown as a numbered backlog group — computed from velocity at render time, no DB row |
| Swimlane | Optional horizontal lane on a free-mode board, crossing all columns |
| WIP limit | Soft per-column card limit on a free-mode board; exceeding it warns but never blocks |
