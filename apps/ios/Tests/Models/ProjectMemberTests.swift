import Foundation
import Testing

@testable import Storylane

@Suite struct ProjectMemberTests {
    @Test func decodesNestedProfileFromSupabaseJoin() throws {
        let json = Data("""
        {
            "user_id": "44444444-4444-4444-4444-444444444444",
            "role": "owner",
            "profiles": { "display_name": "Ada Lovelace" }
        }
        """.utf8)

        let member = try JSONDecoder().decode(ProjectMember.self, from: json)

        #expect(member.userId == UUID(uuidString: "44444444-4444-4444-4444-444444444444"))
        #expect(member.role == "owner")
        #expect(member.profile?.displayName == "Ada Lovelace")
    }

    @Test func idMirrorsUserId() {
        let userId = UUID()
        let member = ProjectMember(userId: userId, role: "member", profile: nil)

        #expect(member.id == userId)
    }

    @Test func displayNameUsesProfileWhenPresent() {
        let member = ProjectMember(
            userId: UUID(),
            role: "member",
            profile: ProfileInfo(displayName: "Grace Hopper")
        )

        #expect(member.displayName == "Grace Hopper")
    }

    @Test func displayNameFallsBackToShortUuidWhenProfileMissing() throws {
        let userId = try #require(UUID(uuidString: "55555555-5555-5555-5555-555555555555"))
        let member = ProjectMember(userId: userId, role: "viewer", profile: nil)

        #expect(member.displayName == "55555555")
    }

    @Test func displayNameFallsBackWhenProfileDisplayNameIsNil() throws {
        let userId = try #require(UUID(uuidString: "66666666-6666-6666-6666-666666666666"))
        let member = ProjectMember(
            userId: userId,
            role: "member",
            profile: ProfileInfo(displayName: nil)
        )

        #expect(member.displayName == "66666666")
    }
}
