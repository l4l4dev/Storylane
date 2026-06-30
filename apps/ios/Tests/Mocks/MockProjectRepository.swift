import Foundation

@testable import Storylane

enum TestError: Error { case stubbed }

/// Test double for `ProjectRepositoryProtocol`. Records calls and returns
/// canned values, or throws `errorToThrow` when set. `@unchecked Sendable` is
/// safe here: tests drive it serially from the main actor.
final class MockProjectRepository: ProjectRepositoryProtocol, @unchecked Sendable {
    struct CreatedProject: Equatable {
        let name: String
        let description: String?
        let iterationLength: Int
        let pointScale: String
    }

    struct Invite: Equatable {
        let projectId: UUID
        let email: String
        let role: String
    }

    struct RoleUpdate: Equatable {
        let projectId: UUID
        let userId: UUID
        let role: String
    }

    struct Removal: Equatable {
        let projectId: UUID
        let userId: UUID
    }

    // Stubs
    var projectsToReturn: [Project] = []
    var membersToReturn: [ProjectMember] = []
    var errorToThrow: Error?

    // Recorded calls
    private(set) var fetchProjectsCallCount = 0
    private(set) var createdProjects: [CreatedProject] = []
    private(set) var updatedProjects: [Project] = []
    private(set) var fetchMembersProjectIds: [UUID] = []
    private(set) var invites: [Invite] = []
    private(set) var roleUpdates: [RoleUpdate] = []
    private(set) var removals: [Removal] = []

    func fetchProjects() async throws -> [Project] {
        fetchProjectsCallCount += 1
        if let errorToThrow { throw errorToThrow }
        return projectsToReturn
    }

    func createProject(
        name: String,
        description: String?,
        iterationLength: Int,
        pointScale: String
    ) async throws {
        createdProjects.append(
            CreatedProject(
                name: name,
                description: description,
                iterationLength: iterationLength,
                pointScale: pointScale
            )
        )
        if let errorToThrow { throw errorToThrow }
    }

    func updateProject(_ project: Project) async throws {
        updatedProjects.append(project)
        if let errorToThrow { throw errorToThrow }
    }

    func fetchMembers(projectId: UUID) async throws -> [ProjectMember] {
        fetchMembersProjectIds.append(projectId)
        if let errorToThrow { throw errorToThrow }
        return membersToReturn
    }

    func inviteMember(projectId: UUID, email: String, role: String) async throws {
        invites.append(Invite(projectId: projectId, email: email, role: role))
        if let errorToThrow { throw errorToThrow }
    }

    func updateMemberRole(projectId: UUID, userId: UUID, role: String) async throws {
        roleUpdates.append(RoleUpdate(projectId: projectId, userId: userId, role: role))
        if let errorToThrow { throw errorToThrow }
    }

    func removeMember(projectId: UUID, userId: UUID) async throws {
        removals.append(Removal(projectId: projectId, userId: userId))
        if let errorToThrow { throw errorToThrow }
    }
}

extension Project {
    /// Convenience factory for tests.
    static func fixture(
        id: UUID = UUID(),
        name: String = "Test Project",
        description: String? = nil,
        velocityWindow: Int = 3,
        iterationLength: Int = 14,
        pointScale: String = "fibonacci"
    ) -> Project {
        Project(
            id: id,
            name: name,
            description: description,
            velocityWindow: velocityWindow,
            iterationLength: iterationLength,
            pointScale: pointScale
        )
    }
}
