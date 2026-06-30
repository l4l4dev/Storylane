import Foundation

@MainActor
@Observable
final class ProjectListViewModel {
    private(set) var projects: [Project] = []
    private(set) var isLoading = false
    var errorMessage: String?

    private let repository: ProjectRepositoryProtocol

    init(repository: ProjectRepositoryProtocol = ProjectRepository()) {
        self.repository = repository
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            projects = try await repository.fetchProjects()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func createProject(
        name: String,
        description: String?,
        iterationLength: Int,
        pointScale: String
    ) async -> Bool {
        do {
            try await repository.createProject(
                name: name,
                description: description,
                iterationLength: iterationLength,
                pointScale: pointScale
            )
            await load()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
