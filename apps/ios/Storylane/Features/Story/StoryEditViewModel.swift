import Foundation

@MainActor
@Observable
final class StoryEditViewModel {
    var title: String
    var descriptionText: String
    var storyType: StoryType
    var pointsText: String
    var isSaving = false
    var errorMessage: String?

    let isEditMode: Bool
    private let projectId: UUID
    private let existingStory: Story?
    private let repository: StoryRepositoryProtocol

    init(
        projectId: UUID,
        story: Story? = nil,
        repository: StoryRepositoryProtocol = StoryRepository()
    ) {
        self.projectId = projectId
        self.existingStory = story
        self.isEditMode = story != nil
        self.repository = repository
        self.title = story?.title ?? ""
        self.descriptionText = story?.description ?? ""
        self.storyType = story?.storyType ?? .feature
        self.pointsText = story?.points.map(String.init) ?? ""
    }

    var isSaveDisabled: Bool { title.trimmingCharacters(in: .whitespaces).isEmpty || isSaving }

    func save() async -> Bool {
        isSaving = true
        defer { isSaving = false }
        let trimmedTitle = title.trimmingCharacters(in: .whitespaces)
        let desc: String? = descriptionText.trimmingCharacters(in: .whitespaces).isEmpty
            ? nil
            : descriptionText.trimmingCharacters(in: .whitespaces)
        let points: Int? = storyType.usesPoints ? Int(pointsText) : nil
        do {
            if let existing = existingStory {
                var updated = existing
                updated.title = trimmedTitle
                updated.description = desc
                updated.storyType = storyType
                updated.points = points
                try await repository.updateStory(updated)
            } else {
                _ = try await repository.createStory(NewStoryParams(
                    projectId: projectId,
                    title: trimmedTitle,
                    description: desc,
                    storyType: storyType,
                    points: points,
                    assigneeId: nil,
                    epicId: nil
                ))
            }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
