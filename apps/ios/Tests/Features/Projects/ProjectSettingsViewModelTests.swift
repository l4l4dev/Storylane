import Foundation
import Testing

@testable import Storylane

@MainActor
@Suite struct ProjectSettingsViewModelTests {
    private func makeViewModel(
        project: Project = .fixture(),
        mock: MockProjectRepository
    ) -> ProjectSettingsViewModel {
        ProjectSettingsViewModel(project: project, repository: mock)
    }

    @Test func loadMembersPopulatesMembers() async {
        let mock = MockProjectRepository()
        let project = Project.fixture()
        mock.membersToReturn = [
            ProjectMember(userId: UUID(), role: "owner", profile: ProfileInfo(displayName: "Ada"))
        ]
        let viewModel = makeViewModel(project: project, mock: mock)

        await viewModel.loadMembers()

        #expect(viewModel.members.count == 1)
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage == nil)
        #expect(mock.fetchMembersProjectIds == [project.id])
    }

    @Test func loadMembersSetsErrorOnFailure() async {
        let mock = MockProjectRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = makeViewModel(mock: mock)

        await viewModel.loadMembers()

        #expect(viewModel.members.isEmpty)
        #expect(viewModel.errorMessage != nil)
        #expect(viewModel.isLoading == false)
    }

    @Test func saveProjectForwardsCurrentProject() async {
        let mock = MockProjectRepository()
        let project = Project.fixture(name: "Before")
        let viewModel = makeViewModel(project: project, mock: mock)
        viewModel.project.name = "After"

        await viewModel.saveProject()

        #expect(mock.updatedProjects.count == 1)
        #expect(mock.updatedProjects[0].name == "After")
        #expect(viewModel.errorMessage == nil)
    }

    @Test func saveProjectSetsErrorOnFailure() async {
        let mock = MockProjectRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = makeViewModel(mock: mock)

        await viewModel.saveProject()

        #expect(viewModel.errorMessage != nil)
    }

    @Test func inviteForwardsArgumentsAndReloadsMembers() async {
        let mock = MockProjectRepository()
        let project = Project.fixture()
        let viewModel = makeViewModel(project: project, mock: mock)

        await viewModel.invite(email: "new@example.com", role: "member")

        #expect(mock.invites.count == 1)
        #expect(mock.invites[0].projectId == project.id)
        #expect(mock.invites[0].email == "new@example.com")
        #expect(mock.invites[0].role == "member")
        // Reloaded members after inviting.
        #expect(mock.fetchMembersProjectIds == [project.id])
    }

    @Test func inviteSetsErrorAndSkipsReloadOnFailure() async {
        let mock = MockProjectRepository()
        mock.errorToThrow = TestError.stubbed
        let viewModel = makeViewModel(mock: mock)

        await viewModel.invite(email: "x@example.com", role: "viewer")

        #expect(viewModel.errorMessage != nil)
        #expect(mock.fetchMembersProjectIds.isEmpty)
    }

    @Test func updateRoleForwardsArgumentsAndReloads() async {
        let mock = MockProjectRepository()
        let project = Project.fixture()
        let viewModel = makeViewModel(project: project, mock: mock)
        let userId = UUID()

        await viewModel.updateRole(userId: userId, role: "viewer")

        #expect(mock.roleUpdates.count == 1)
        #expect(mock.roleUpdates[0].projectId == project.id)
        #expect(mock.roleUpdates[0].userId == userId)
        #expect(mock.roleUpdates[0].role == "viewer")
        #expect(mock.fetchMembersProjectIds == [project.id])
    }

    @Test func removeForwardsArgumentsAndReloads() async {
        let mock = MockProjectRepository()
        let project = Project.fixture()
        let viewModel = makeViewModel(project: project, mock: mock)
        let userId = UUID()

        await viewModel.remove(userId: userId)

        #expect(mock.removals.count == 1)
        #expect(mock.removals[0].projectId == project.id)
        #expect(mock.removals[0].userId == userId)
        #expect(mock.fetchMembersProjectIds == [project.id])
    }
}
