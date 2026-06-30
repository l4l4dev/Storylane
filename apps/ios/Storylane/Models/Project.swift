import Foundation

struct Project: Identifiable, Codable, Sendable, Hashable {
    let id: UUID
    var name: String
    var description: String?
    var velocityWindow: Int
    var iterationLength: Int
    var pointScale: String

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case velocityWindow = "velocity_window"
        case iterationLength = "iteration_length"
        case pointScale = "point_scale"
    }
}

enum ProjectOptions {
    static let iterationLengths = [7, 14, 21, 28]
    static let pointScales = ["fibonacci", "linear", "custom"]
    static let roles = ["owner", "member", "viewer"]
}
