import Foundation

private struct NewProjectPayload: Encodable {
    let name: String
    let description: String?
    let iterationLength: Int
    let pointScale: String

    enum CodingKeys: String, CodingKey {
        case name, description
        case iterationLength = "iteration_length"
        case pointScale = "point_scale"
    }
}

private struct ProjectUpdatePayload: Encodable {
    let name: String
    let description: String?
    let iterationLength: Int
    let pointScale: String
    let velocityWindow: Int

    enum CodingKeys: String, CodingKey {
        case name, description
        case iterationLength = "iteration_length"
        case pointScale = "point_scale"
        case velocityWindow = "velocity_window"
    }
}

private struct InviteParams: Encodable {
    let projectId: UUID
    let email: String
    let role: String

    enum CodingKeys: String, CodingKey {
        case projectId = "p_project_id"
        case email = "p_email"
        case role = "p_role"
    }
}

/// All Supabase access for projects and their members.
struct ProjectRepository {
    func fetchProjects() async throws -> [Project] {
        try await supabase
            .from("projects")
            .select()
            .order("updated_at", ascending: false)
            .execute()
            .value
    }

    func createProject(
        name: String,
        description: String?,
        iterationLength: Int,
        pointScale: String
    ) async throws {
        // No `.select()`: avoids INSERT ... RETURNING, which RLS blocks until the
        // owner membership trigger has run. created_by defaults to auth.uid().
        try await supabase
            .from("projects")
            .insert(
                NewProjectPayload(
                    name: name,
                    description: description,
                    iterationLength: iterationLength,
                    pointScale: pointScale
                )
            )
            .execute()
    }

    func updateProject(_ project: Project) async throws {
        try await supabase
            .from("projects")
            .update(
                ProjectUpdatePayload(
                    name: project.name,
                    description: project.description,
                    iterationLength: project.iterationLength,
                    pointScale: project.pointScale,
                    velocityWindow: project.velocityWindow
                )
            )
            .eq("id", value: project.id.uuidString)
            .execute()
    }

    func fetchMembers(projectId: UUID) async throws -> [ProjectMember] {
        try await supabase
            .from("project_members")
            .select("user_id, role, profiles(display_name)")
            .eq("project_id", value: projectId.uuidString)
            .execute()
            .value
    }

    func inviteMember(projectId: UUID, email: String, role: String) async throws {
        try await supabase
            .rpc(
                "invite_member",
                params: InviteParams(projectId: projectId, email: email, role: role)
            )
            .execute()
    }

    func updateMemberRole(projectId: UUID, userId: UUID, role: String) async throws {
        try await supabase
            .from("project_members")
            .update(["role": role])
            .eq("project_id", value: projectId.uuidString)
            .eq("user_id", value: userId.uuidString)
            .execute()
    }

    func removeMember(projectId: UUID, userId: UUID) async throws {
        try await supabase
            .from("project_members")
            .delete()
            .eq("project_id", value: projectId.uuidString)
            .eq("user_id", value: userId.uuidString)
            .execute()
    }
}
