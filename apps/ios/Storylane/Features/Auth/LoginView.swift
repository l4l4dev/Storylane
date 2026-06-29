import SwiftUI

struct LoginView: View {
    @Environment(AuthManager.self) private var auth
    @State private var errorMessage: String?
    @State private var isWorking = false

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 4) {
                Text("Storylane")
                    .font(.largeTitle)
                    .bold()
                Text("Sign in to continue")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 12) {
                Button("Continue with GitHub") {
                    signIn { try await auth.signInWithGitHub() }
                }
                Button("Continue with Google") {
                    signIn { try await auth.signInWithGoogle() }
                }
            }
            .buttonStyle(.bordered)
            .disabled(isWorking)

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .padding()
    }

    private func signIn(_ action: @escaping () async throws -> Void) {
        isWorking = true
        errorMessage = nil
        Task {
            do {
                try await action()
            } catch {
                errorMessage = error.localizedDescription
            }
            isWorking = false
        }
    }
}
