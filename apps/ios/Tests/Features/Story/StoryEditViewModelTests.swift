import Foundation
import Testing

@testable import Storylane

@MainActor
@Suite struct StoryEditViewModelTests {
    let projectId = UUID()

    @Test func createModeInitialisesWithDefaults() {
        let viewModel = StoryEditViewModel(projectId: projectId, story: nil)

        #expect(viewModel.title == "")
        #expect(viewModel.storyType == .feature)
        #expect(viewModel.pointsText == "")
        #expect(viewModel.isEditMode == false)
    }

    @Test func editModeInitialisesFromStory() {
        let story = Story.fixture(
            title: "Login page",
            storyType: .bug,
            points: 5
        )
        let viewModel = StoryEditViewModel(projectId: projectId, story: story)

        #expect(viewModel.title == "Login page")
        #expect(viewModel.storyType == .bug)
        #expect(viewModel.pointsText == "5")
        #expect(viewModel.isEditMode == true)
    }

    @Test func isSaveDisabledWhenTitleIsBlank() {
        let viewModel = StoryEditViewModel(projectId: projectId)

        viewModel.title = "  "

        #expect(viewModel.isSaveDisabled == true)
    }

    @Test func saveCreatesStoryWithParsedPoints() async {
        let mock = MockStoryRepository()
        let viewModel = StoryEditViewModel(projectId: projectId, story: nil, repository: mock)
        viewModel.title = "Add login"
        viewModel.storyType = .feature
        viewModel.pointsText = "3"

        let success = await viewModel.save()

        #expect(success == true)
        #expect(mock.createdParams.count == 1)
        let params = mock.createdParams[0]
        #expect(params.title == "Add login")
        #expect(params.storyType == .feature)
        #expect(params.points == 3)
        #expect(params.projectId == projectId)
    }

    @Test func saveOmitsPointsForChore() async {
        let mock = MockStoryRepository()
        let viewModel = StoryEditViewModel(projectId: projectId, story: nil, repository: mock)
        viewModel.title = "Upgrade deps"
        viewModel.storyType = .chore
        viewModel.pointsText = "5"

        _ = await viewModel.save()

        #expect(mock.createdParams[0].points == nil)
    }

    @Test func saveUpdatesExistingStory() async {
        let original = Story.fixture(title: "Old", storyType: .feature, points: 1)
        let mock = MockStoryRepository()
        let viewModel = StoryEditViewModel(projectId: projectId, story: original, repository: mock)
        viewModel.title = "Updated title"
        viewModel.pointsText = "8"

        let success = await viewModel.save()

        #expect(success == true)
        #expect(mock.updatedStories.count == 1)
        #expect(mock.updatedStories[0].title == "Updated title")
        #expect(mock.updatedStories[0].points == 8)
        #expect(mock.createdParams.isEmpty)
    }

    @Test func saveReturnsFalseAndSetsErrorOnFailure() async {
        let mock = MockStoryRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = StoryEditViewModel(projectId: projectId, story: nil, repository: mock)
        viewModel.title = "New story"

        let success = await viewModel.save()

        #expect(success == false)
        #expect(viewModel.errorMessage != nil)
    }
}
