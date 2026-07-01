import Foundation

struct NewStoryParams: Sendable {
    let projectId: UUID
    let title: String
    let description: String?
    let storyType: StoryType
    let points: Int?
    let assigneeId: UUID?
    let epicId: UUID?
}

protocol StoryRepositoryProtocol: Sendable {
    func fetchStories(projectId: UUID) async throws -> [Story]
    func fetchStory(id: UUID) async throws -> Story
    func createStory(_ params: NewStoryParams) async throws -> Story
    func updateStory(_ story: Story) async throws
    func updateStoryState(id: UUID, state: StoryState) async throws
    func deleteStory(id: UUID) async throws
}

private struct NewStoryPayload: Encodable {
    let projectId: UUID
    let title: String
    let description: String?
    let storyType: String
    let points: Int?

    enum CodingKeys: String, CodingKey {
        case title, description, points
        case projectId = "project_id"
        case storyType = "story_type"
    }
}

private struct StoryUpdatePayload: Encodable {
    let title: String
    let description: String?
    let storyType: String
    let state: String
    let points: Int?

    enum CodingKeys: String, CodingKey {
        case title, description, state, points
        case storyType = "story_type"
    }
}

struct StoryRepository: StoryRepositoryProtocol {
    func fetchStories(projectId: UUID) async throws -> [Story] {
        try await supabase
            .from("stories")
            .select()
            .eq("project_id", value: projectId.uuidString)
            .order("position", ascending: true)
            .execute()
            .value
    }

    func fetchStory(id: UUID) async throws -> Story {
        try await supabase
            .from("stories")
            .select()
            .eq("id", value: id.uuidString)
            .single()
            .execute()
            .value
    }

    func createStory(_ params: NewStoryParams) async throws -> Story {
        try await supabase
            .from("stories")
            .insert(NewStoryPayload(
                projectId: params.projectId,
                title: params.title,
                description: params.description,
                storyType: params.storyType.rawValue,
                points: params.points
            ))
            .select()
            .single()
            .execute()
            .value
    }

    func updateStory(_ story: Story) async throws {
        try await supabase
            .from("stories")
            .update(StoryUpdatePayload(
                title: story.title,
                description: story.description,
                storyType: story.storyType.rawValue,
                state: story.state.rawValue,
                points: story.points
            ))
            .eq("id", value: story.id.uuidString)
            .execute()
    }

    func updateStoryState(id: UUID, state: StoryState) async throws {
        try await supabase
            .from("stories")
            .update(["state": state.rawValue])
            .eq("id", value: id.uuidString)
            .execute()
    }

    func deleteStory(id: UUID) async throws {
        try await supabase
            .from("stories")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }
}
