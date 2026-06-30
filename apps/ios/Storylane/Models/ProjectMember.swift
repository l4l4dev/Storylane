import Foundation

struct ProfileInfo: Codable, Sendable, Hashable {
    let displayName: String?

    enum CodingKeys: String, CodingKey {
        case displayName = "display_name"
    }
}

struct ProjectMember: Identifiable, Codable, Sendable, Hashable {
    let userId: UUID
    var role: String
    let profile: ProfileInfo?

    var id: UUID { userId }
    var displayName: String { profile?.displayName ?? String(userId.uuidString.prefix(8)) }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case role
        case profile = "profiles"
    }
}
