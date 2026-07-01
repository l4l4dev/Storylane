import Foundation

@testable import Storylane

final class MockStoryRepository: StoryRepositoryProtocol, @unchecked Sendable {
    struct StateUpdate: Equatable {
        let id: UUID
        let state: StoryState
    }

    // Stubs
    var storiesToReturn: [Story] = []
    var storyToReturn: Story?
    var createdStoryToReturn: Story = .fixture()
    var errorToThrow: Error?

    // Recorded calls
    private(set) var fetchStoriesProjectIds: [UUID] = []
    private(set) var fetchStoryIds: [UUID] = []
    private(set) var createdParams: [NewStoryParams] = []
    private(set) var updatedStories: [Story] = []
    private(set) var stateUpdates: [StateUpdate] = []
    private(set) var deletedIds: [UUID] = []

    func fetchStories(projectId: UUID) async throws -> [Story] {
        fetchStoriesProjectIds.append(projectId)
        if let errorToThrow { throw errorToThrow }
        return storiesToReturn
    }

    func fetchStory(id: UUID) async throws -> Story {
        fetchStoryIds.append(id)
        if let errorToThrow { throw errorToThrow }
        return storyToReturn ?? .fixture(id: id)
    }

    func createStory(_ params: NewStoryParams) async throws -> Story {
        createdParams.append(params)
        if let errorToThrow { throw errorToThrow }
        return createdStoryToReturn
    }

    func updateStory(_ story: Story) async throws {
        updatedStories.append(story)
        if let errorToThrow { throw errorToThrow }
    }

    func updateStoryState(id: UUID, state: StoryState) async throws {
        stateUpdates.append(StateUpdate(id: id, state: state))
        if let errorToThrow { throw errorToThrow }
    }

    func deleteStory(id: UUID) async throws {
        deletedIds.append(id)
        if let errorToThrow { throw errorToThrow }
    }
}

extension Story {
    static func fixture(
        id: UUID = UUID(),
        title: String = "Test story",
        description: String? = nil,
        storyType: StoryType = .feature,
        state: StoryState = .unstarted,
        points: Int? = 2,
        position: Int = 0,
        projectId: UUID = UUID(),
        assigneeId: UUID? = nil,
        epicId: UUID? = nil
    ) -> Story {
        Story(
            id: id,
            title: title,
            description: description,
            storyType: storyType,
            state: state,
            points: points,
            position: position,
            projectId: projectId,
            assigneeId: assigneeId,
            epicId: epicId
        )
    }
}
