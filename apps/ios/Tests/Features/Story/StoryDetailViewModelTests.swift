import Foundation
import Testing

@testable import Storylane

@MainActor
@Suite struct StoryDetailViewModelTests {
    @Test func advanceStateUpdatesLocalStoryAndCallsRepository() async {
        let id = UUID()
        let story = Story.fixture(id: id, state: .unstarted)
        let mock = MockStoryRepository()
        let viewModel = StoryDetailViewModel(story: story, repository: mock)

        await viewModel.advanceState()

        #expect(viewModel.story.state == .started)
        #expect(mock.stateUpdates.count == 1)
        #expect(mock.stateUpdates[0].id == id)
        #expect(mock.stateUpdates[0].state == .started)
    }

    @Test func advanceStateDoesNothingForAccepted() async {
        let story = Story.fixture(state: .accepted)
        let mock = MockStoryRepository()
        let viewModel = StoryDetailViewModel(story: story, repository: mock)

        await viewModel.advanceState()

        #expect(mock.stateUpdates.isEmpty)
        #expect(viewModel.story.state == .accepted)
    }

    @Test func advanceStateSetsErrorOnFailure() async {
        let story = Story.fixture(state: .unstarted)
        let mock = MockStoryRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = StoryDetailViewModel(story: story, repository: mock)

        await viewModel.advanceState()

        #expect(viewModel.errorMessage != nil)
        #expect(viewModel.story.state == .unstarted)
    }

    @Test func rejectStoryUpdatesStateToRejected() async {
        let id = UUID()
        let story = Story.fixture(id: id, state: .delivered)
        let mock = MockStoryRepository()
        let viewModel = StoryDetailViewModel(story: story, repository: mock)

        await viewModel.rejectStory()

        #expect(viewModel.story.state == .rejected)
        #expect(mock.stateUpdates[0].state == .rejected)
    }

    @Test func deleteStoryReturnsTrueAndCallsRepository() async {
        let id = UUID()
        let story = Story.fixture(id: id)
        let mock = MockStoryRepository()
        let viewModel = StoryDetailViewModel(story: story, repository: mock)

        let result = await viewModel.deleteStory()

        #expect(result == true)
        #expect(mock.deletedIds == [id])
        #expect(viewModel.errorMessage == nil)
    }

    @Test func deleteStoryReturnsFalseAndSetsErrorOnFailure() async {
        let story = Story.fixture()
        let mock = MockStoryRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = StoryDetailViewModel(story: story, repository: mock)

        let result = await viewModel.deleteStory()

        #expect(result == false)
        #expect(viewModel.errorMessage != nil)
    }

    @Test func reloadStoryFetchesUpdatedData() async {
        let id = UUID()
        let original = Story.fixture(id: id, title: "Old title")
        let updated = Story.fixture(id: id, title: "New title")
        let mock = MockStoryRepository()
        mock.storyToReturn = updated
        let viewModel = StoryDetailViewModel(story: original, repository: mock)

        await viewModel.reloadStory()

        #expect(viewModel.story.title == "New title")
        #expect(mock.fetchStoryIds == [id])
    }
}
