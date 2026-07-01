← [SPEC.md](../SPEC.md)

## Screen Structure

### Web (Next.js)

```
/                         Login / top page
/auth/login               Login (OAuth)
/dashboard                Project list
/projects/[id]            Project home (backlog + current iteration)
/projects/[id]/backlog    Backlog detail
/projects/[id]/iterations Iteration list
/projects/[id]/epics      Epic list
/projects/[id]/settings   Project settings (members, integrations, point scale, etc.)
/stories/[id]             Story detail (modal or standalone page)
```

### iOS (SwiftUI)

```
TabView
├── Backlog          BacklogView
├── Iterations       IterationsView
├── Epics            EpicsView
└── Settings         SettingsView

Sub-screens
├── StoryDetailView  Story detail
├── StoryEditView    Create / edit story
└── ProjectListView  Project selection (on launch)
```
