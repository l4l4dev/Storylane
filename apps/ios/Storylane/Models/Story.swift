import Foundation

enum StoryType: String, Codable, CaseIterable, Sendable {
    case feature, bug, chore, release

    var usesPoints: Bool { self == .feature || self == .bug }
    var label: String { rawValue.capitalized }

    var icon: String {
        switch self {
        case .feature: "star.fill"
        case .bug: "ladybug.fill"
        case .chore: "gear"
        case .release: "tag.fill"
        }
    }
}

enum StoryState: String, Codable, CaseIterable, Sendable {
    case unstarted, started, finished, delivered, accepted, rejected

    var displayName: String {
        switch self {
        case .unstarted: "Unstarted"
        case .started: "Started"
        case .finished: "Finished"
        case .delivered: "Delivered"
        case .accepted: "Accepted"
        case .rejected: "Rejected"
        }
    }

    var advanceLabel: String? {
        switch self {
        case .unstarted: "Start"
        case .started: "Finish"
        case .finished: "Deliver"
        case .delivered: "Accept"
        case .accepted: nil
        case .rejected: "Restart"
        }
    }

    var primaryNextState: StoryState? {
        switch self {
        case .unstarted: .started
        case .started: .finished
        case .finished: .delivered
        case .delivered: .accepted
        case .accepted: nil
        case .rejected: .started
        }
    }
}

struct Story: Identifiable, Codable, Sendable, Hashable {
    let id: UUID
    var title: String
    var description: String?
    var storyType: StoryType
    var state: StoryState
    var points: Int?
    var position: Int
    var projectId: UUID
    var assigneeId: UUID?
    var epicId: UUID?

    enum CodingKeys: String, CodingKey {
        case id, title, description, state, points, position
        case storyType = "story_type"
        case projectId = "project_id"
        case assigneeId = "assignee_id"
        case epicId = "epic_id"
    }
}
