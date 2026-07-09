# iOS (Swift) Conventions

## General
- Use the latest stable Swift and SwiftUI APIs
- Prefer SwiftUI; use UIKit only when necessary
- Always use `@MainActor` appropriately — UI updates must happen on the main thread

## Naming
- Types and protocols: `UpperCamelCase` (e.g. `StoryDetailView`, `ProjectRepository`)
- Variables and functions: `lowerCamelCase` (e.g. `currentIteration`, `fetchStories()`)
- Constants: `lowerCamelCase` with `let`
- File names: match the type name (e.g. `StoryDetailView.swift`)

## Architecture
- Follow MVVM
- Views handle presentation only — business logic belongs in ViewModels or Repositories
- All Supabase communication goes through the Repository layer

```
apps/ios/Storylane/
├── Features/
│   ├── Backlog/
│   │   ├── BacklogView.swift
│   │   └── BacklogViewModel.swift
│   ├── Story/
│   │   ├── StoryDetailView.swift
│   │   └── StoryDetailViewModel.swift
│   └── ...
├── Repositories/
│   ├── StoryRepository.swift
│   └── ProjectRepository.swift
├── Models/
│   └── Story.swift, Project.swift ...
└── Core/
    └── SupabaseClient.swift
```

## Testing
- Use **Swift Testing** — never XCTest
- Write unit tests for ViewModels and Repositories
- Place test files under `Tests/` mirroring the same folder structure

```swift
// Example
@Test func fetchStoriesReturnsBacklogItems() async throws {
    let repository = StoryRepository(client: mockClient)
    let stories = try await repository.fetchBacklog(projectId: testProjectId)
    #expect(stories.isEmpty == false)
}
```

## Do Not
- Use force unwrap (`!`) in Swift — use `guard let` or `if let` instead
