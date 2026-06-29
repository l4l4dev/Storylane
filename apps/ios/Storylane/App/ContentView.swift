import SwiftUI

struct ContentView: View {
    @Environment(AuthManager.self) private var auth

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "checklist")
                .font(.largeTitle)
            Text("Storylane")
                .font(.title2)
                .bold()
            if let email = auth.session?.user.email {
                Text("Signed in as \(email)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Button("Sign out") {
                Task { try? await auth.signOut() }
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }
}
