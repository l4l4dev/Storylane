import Foundation
import Testing

@testable import Storylane

@Suite struct ProjectTests {
    @Test func decodesSnakeCaseKeysFromSupabaseRow() throws {
        let json = Data("""
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "Apollo",
            "description": "Moon shot",
            "velocity_window": 3,
            "iteration_length": 14,
            "point_scale": "fibonacci"
        }
        """.utf8)

        let project = try JSONDecoder().decode(Project.self, from: json)

        #expect(project.id == UUID(uuidString: "11111111-1111-1111-1111-111111111111"))
        #expect(project.name == "Apollo")
        #expect(project.description == "Moon shot")
        #expect(project.velocityWindow == 3)
        #expect(project.iterationLength == 14)
        #expect(project.pointScale == "fibonacci")
    }

    @Test func decodesNullDescription() throws {
        let json = Data("""
        {
            "id": "22222222-2222-2222-2222-222222222222",
            "name": "Gemini",
            "description": null,
            "velocity_window": 1,
            "iteration_length": 7,
            "point_scale": "linear"
        }
        """.utf8)

        let project = try JSONDecoder().decode(Project.self, from: json)

        #expect(project.description == nil)
    }

    @Test func encodeThenDecodeRoundTrips() throws {
        let original = Project(
            id: UUID(),
            name: "Mercury",
            description: nil,
            velocityWindow: 2,
            iterationLength: 21,
            pointScale: "custom"
        )

        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Project.self, from: data)

        #expect(decoded == original)
    }

    @Test func encodesUsingSnakeCaseKeys() throws {
        let knownId = try #require(UUID(uuidString: "33333333-3333-3333-3333-333333333333"))
        let project = Project(
            id: knownId,
            name: "Voyager",
            description: nil,
            velocityWindow: 4,
            iterationLength: 28,
            pointScale: "fibonacci"
        )

        let data = try JSONEncoder().encode(project)
        let object = try #require(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        #expect(object["velocity_window"] as? Int == 4)
        #expect(object["iteration_length"] as? Int == 28)
        #expect(object["point_scale"] as? String == "fibonacci")
    }

    @Test func optionsExposeExpectedChoices() {
        #expect(ProjectOptions.iterationLengths == [7, 14, 21, 28])
        #expect(ProjectOptions.pointScales == ["fibonacci", "linear", "custom"])
        #expect(ProjectOptions.roles == ["owner", "member", "viewer"])
    }
}
