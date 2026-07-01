import Foundation

@MainActor
@Observable
final class BacklogViewModel {
    private(set) var stories: [Story] = []
    private(set) var isLoading = false
    var errorMessage: String?

    let project: Project
    private let repository: StoryRepositoryProtocol

    init(project: Project, repository: StoryRepositoryProtocol = StoryRepository()) {
        self.project = project
        self.repository = repository
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            stories = try await repository.fetchStories(projectId: project.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func advanceState(for story: Story) async {
        guard let next = story.state.primaryNextState else { return }
        do {
            try await repository.updateStoryState(id: story.id, state: next)
            if let idx = stories.firstIndex(where: { $0.id == story.id }) {
                stories[idx].state = next
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func rejectStory(_ story: Story) async {
        do {
            try await repository.updateStoryState(id: story.id, state: .rejected)
            if let idx = stories.firstIndex(where: { $0.id == story.id }) {
                stories[idx].state = .rejected
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteStory(_ story: Story) async {
        do {
            try await repository.deleteStory(id: story.id)
            stories.removeAll { $0.id == story.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
