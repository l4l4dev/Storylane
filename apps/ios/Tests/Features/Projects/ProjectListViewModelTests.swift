import Foundation
import Testing

@testable import Storylane

@MainActor
@Suite struct ProjectListViewModelTests {
    @Test func loadPopulatesProjectsAndClearsLoading() async {
        let mock = MockProjectRepository()
        mock.projectsToReturn = [.fixture(name: "Apollo"), .fixture(name: "Gemini")]
        let viewModel = ProjectListViewModel(repository: mock)

        await viewModel.load()

        #expect(viewModel.projects.map(\.name) == ["Apollo", "Gemini"])
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage == nil)
        #expect(mock.fetchProjectsCallCount == 1)
    }

    @Test func loadSetsErrorMessageOnFailure() async {
        let mock = MockProjectRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = ProjectListViewModel(repository: mock)

        await viewModel.load()

        #expect(viewModel.projects.isEmpty)
        #expect(viewModel.errorMessage != nil)
        #expect(viewModel.isLoading == false)
    }

    @Test func createProjectForwardsArgumentsAndReloads() async {
        let mock = MockProjectRepository()
        let viewModel = ProjectListViewModel(repository: mock)

        let success = await viewModel.createProject(
            name: "Voyager",
            description: "Deep space",
            iterationLength: 21,
            pointScale: "linear"
        )

        #expect(success == true)
        #expect(mock.createdProjects.count == 1)
        let created = mock.createdProjects[0]
        #expect(created.name == "Voyager")
        #expect(created.description == "Deep space")
        #expect(created.iterationLength == 21)
        #expect(created.pointScale == "linear")
        // Reloaded after creating.
        #expect(mock.fetchProjectsCallCount == 1)
    }

    @Test func createProjectReturnsFalseAndSetsErrorOnFailure() async {
        let mock = MockProjectRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = ProjectListViewModel(repository: mock)

        let success = await viewModel.createProject(
            name: "Mercury",
            description: nil,
            iterationLength: 7,
            pointScale: "fibonacci"
        )

        #expect(success == false)
        #expect(viewModel.errorMessage != nil)
        // No reload happened because create threw.
        #expect(mock.fetchProjectsCallCount == 0)
    }
}
