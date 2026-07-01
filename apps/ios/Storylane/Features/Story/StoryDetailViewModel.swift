import Foundation

@MainActor
@Observable
final class StoryDetailViewModel {
    var story: Story
    var errorMessage: String?

    private let repository: StoryRepositoryProtocol

    init(story: Story, repository: StoryRepositoryProtocol = StoryRepository()) {
        self.story = story
        self.repository = repository
    }

    func reloadStory() async {
        do {
            story = try await repository.fetchStory(id: story.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func advanceState() async {
        guard let next = story.state.primaryNextState else { return }
        do {
            try await repository.updateStoryState(id: story.id, state: next)
            story.state = next
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func rejectStory() async {
        do {
            try await repository.updateStoryState(id: story.id, state: .rejected)
            story.state = .rejected
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteStory() async -> Bool {
        do {
            try await repository.deleteStory(id: story.id)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
