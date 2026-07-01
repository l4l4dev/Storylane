import Foundation
import Testing

@testable import Storylane

@MainActor
@Suite struct BacklogViewModelTests {
    let project = Project.fixture()

    @Test func loadPopulatesStoriesAndClearsLoading() async {
        let mock = MockStoryRepository()
        let s1 = Story.fixture(title: "Auth", position: 0)
        let s2 = Story.fixture(title: "Dashboard", position: 1)
        mock.storiesToReturn = [s1, s2]
        let viewModel = BacklogViewModel(project: project, repository: mock)

        await viewModel.load()

        #expect(viewModel.stories.map(\.title) == ["Auth", "Dashboard"])
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage == nil)
        #expect(mock.fetchStoriesProjectIds == [project.id])
    }

    @Test func loadSetsErrorMessageOnFailure() async {
        let mock = MockStoryRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = BacklogViewModel(project: project, repository: mock)

        await viewModel.load()

        #expect(viewModel.stories.isEmpty)
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage != nil)
    }

    @Test func advanceStateUpdatesLocalStoriesAndCallsRepository() async {
        let storyId = UUID()
        let story = Story.fixture(id: storyId, state: .unstarted)
        let mock = MockStoryRepository()
        mock.storiesToReturn = [story]
        let viewModel = BacklogViewModel(project: project, repository: mock)
        await viewModel.load()

        await viewModel.advanceState(for: story)

        #expect(viewModel.stories.first?.state == .started)
        #expect(mock.stateUpdates.count == 1)
        #expect(mock.stateUpdates[0].id == storyId)
        #expect(mock.stateUpdates[0].state == .started)
    }

    @Test func advanceStateDoesNothingForAccepted() async {
        let story = Story.fixture(state: .accepted)
        let mock = MockStoryRepository()
        mock.storiesToReturn = [story]
        let viewModel = BacklogViewModel(project: project, repository: mock)
        await viewModel.load()

        await viewModel.advanceState(for: story)

        #expect(mock.stateUpdates.isEmpty)
        #expect(viewModel.stories.first?.state == .accepted)
    }

    @Test func rejectStoryUpdatesStateToRejected() async {
        let storyId = UUID()
        let story = Story.fixture(id: storyId, state: .delivered)
        let mock = MockStoryRepository()
        mock.storiesToReturn = [story]
        let viewModel = BacklogViewModel(project: project, repository: mock)
        await viewModel.load()

        await viewModel.rejectStory(story)

        #expect(viewModel.stories.first?.state == .rejected)
        #expect(mock.stateUpdates[0].state == .rejected)
    }

    @Test func deleteStoryRemovesItFromLocalList() async {
        let storyId = UUID()
        let story = Story.fixture(id: storyId)
        let mock = MockStoryRepository()
        mock.storiesToReturn = [story]
        let viewModel = BacklogViewModel(project: project, repository: mock)
        await viewModel.load()

        await viewModel.deleteStory(story)

        #expect(viewModel.stories.isEmpty)
        #expect(mock.deletedIds == [storyId])
    }

    @Test func deleteStorySetsErrorOnFailure() async {
        let story = Story.fixture()
        let mock = MockStoryRepository()
        mock.storiesToReturn = [story]
        let viewModel = BacklogViewModel(project: project, repository: mock)
        await viewModel.load()
        mock.errorToThrow = TestError.stubbed

        await viewModel.deleteStory(story)

        #expect(viewModel.errorMessage != nil)
        #expect(viewModel.stories.count == 1)
    }
}
