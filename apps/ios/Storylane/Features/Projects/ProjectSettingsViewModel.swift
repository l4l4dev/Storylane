import Foundation

@MainActor
@Observable
final class ProjectSettingsViewModel {
    var project: Project
    private(set) var members: [ProjectMember] = []
    private(set) var isLoading = false
    var errorMessage: String?

    private let repository = ProjectRepository()

    init(project: Project) {
        self.project = project
    }

    func loadMembers() async {
        isLoading = true
        errorMessage = nil
        do {
            members = try await repository.fetchMembers(projectId: project.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func saveProject() async {
        do {
            try await repository.updateProject(project)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func invite(email: String, role: String) async {
        errorMessage = nil
        do {
            try await repository.inviteMember(projectId: project.id, email: email, role: role)
            await loadMembers()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func updateRole(userId: UUID, role: String) async {
        do {
            try await repository.updateMemberRole(projectId: project.id, userId: userId, role: role)
            await loadMembers()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func remove(userId: UUID) async {
        do {
            try await repository.removeMember(projectId: project.id, userId: userId)
            await loadMembers()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
