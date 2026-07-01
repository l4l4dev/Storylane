import Foundation
import Testing

@testable import Storylane

@Suite struct StoryTests {
    @Test func decodesSnakeCaseKeys() throws {
        let json = """
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "title": "Login flow",
            "description": null,
            "story_type": "feature",
            "state": "unstarted",
            "points": 3,
            "position": 0,
            "project_id": "00000000-0000-0000-0000-000000000002",
            "assignee_id": null,
            "epic_id": null
        }
        """
        let story = try JSONDecoder().decode(Story.self, from: Data(json.utf8))
        #expect(story.title == "Login flow")
        #expect(story.storyType == .feature)
        #expect(story.state == .unstarted)
        #expect(story.points == 3)
        #expect(story.projectId == UUID(uuidString: "00000000-0000-0000-0000-000000000002"))
        #expect(story.assigneeId == nil)
    }

    @Test func roundTripEncodeDecode() throws {
        let original = Story.fixture(title: "Deploy pipeline", storyType: .chore, points: nil)
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Story.self, from: data)
        #expect(decoded.id == original.id)
        #expect(decoded.title == original.title)
        #expect(decoded.storyType == .chore)
        #expect(decoded.points == nil)
    }

    @Test func storyTypeUsesPointsOnlyForFeatureAndBug() {
        #expect(StoryType.feature.usesPoints == true)
        #expect(StoryType.bug.usesPoints == true)
        #expect(StoryType.chore.usesPoints == false)
        #expect(StoryType.release.usesPoints == false)
    }

    @Test func storyStatePrimaryNextStateFollowsWorkflow() {
        #expect(StoryState.unstarted.primaryNextState == .started)
        #expect(StoryState.started.primaryNextState == .finished)
        #expect(StoryState.finished.primaryNextState == .delivered)
        #expect(StoryState.delivered.primaryNextState == .accepted)
        #expect(StoryState.accepted.primaryNextState == nil)
        #expect(StoryState.rejected.primaryNextState == .started)
    }

    @Test func storyStateAdvanceLabelMatchesWorkflow() {
        #expect(StoryState.unstarted.advanceLabel == "Start")
        #expect(StoryState.started.advanceLabel == "Finish")
        #expect(StoryState.finished.advanceLabel == "Deliver")
        #expect(StoryState.delivered.advanceLabel == "Accept")
        #expect(StoryState.accepted.advanceLabel == nil)
        #expect(StoryState.rejected.advanceLabel == "Restart")
    }

    @Test func encodedKeysAreSnakeCase() throws {
        let story = Story.fixture()
        let data = try JSONEncoder().encode(story)
        let dict = try JSONDecoder().decode([String: AnyCodable].self, from: data)
        #expect(dict["story_type"] != nil)
        #expect(dict["project_id"] != nil)
        #expect(dict["storyType"] == nil)
        #expect(dict["projectId"] == nil)
    }
}

// Minimal helper to check JSON key presence without caring about value type.
private struct AnyCodable: Codable {
    init(from decoder: Decoder) throws {
        _ = try? decoder.singleValueContainer()
    }
    func encode(to encoder: Encoder) throws {}
}
