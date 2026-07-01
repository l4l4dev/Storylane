# /new-story

Steps to follow before starting any story-related implementation.

## Checklist

1. Review the story model and state definitions in `spec/data-model.md` (see `stories` and `tasks`)
2. Confirm the story type to implement: feature / bug / chore / release
3. Confirm whether this is an iOS or Web implementation

### iOS

Create the following files:

```
apps/ios/Storylane/Features/Story/
├── StoryDetailView.swift
└── StoryDetailViewModel.swift
```

Use this base pattern for the ViewModel:

```swift
@MainActor
final class StoryDetailViewModel: ObservableObject {
    @Published private(set) var story: Story?
    @Published private(set) var isLoading = false
    @Published private(set) var error: Error?

    private let repository: StoryRepository

    init(repository: StoryRepository = .shared) {
        self.repository = repository
    }
}
```

### Web

Create the following files:

```
apps/web/components/features/story/
├── StoryDetail.tsx
└── StoryCard.tsx
```

4. Write tests using Swift Testing (iOS) or Vitest (Web) after implementing
5. Verify that Supabase RLS policies align with the guidelines in `spec/rls.md`
