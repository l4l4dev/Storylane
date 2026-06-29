import Foundation
import Supabase

/// Observable auth state. The SDK restores any persisted session on launch and
/// emits it through `authStateChanges`.
@MainActor
@Observable
final class AuthManager {
    private(set) var session: Session?
    private(set) var isLoading = true

    /// Starts listening for auth state changes. Emits the restored session (if any) first.
    func start() async {
        for await change in supabase.auth.authStateChanges {
            session = change.session
            isLoading = false
        }
    }

    func signInWithGitHub() async throws {
        try await supabase.auth.signInWithOAuth(
            provider: .github,
            redirectTo: SupabaseConfig.oauthCallback
        )
    }

    func signInWithGoogle() async throws {
        try await supabase.auth.signInWithOAuth(
            provider: .google,
            redirectTo: SupabaseConfig.oauthCallback
        )
    }

    func signOut() async throws {
        try await supabase.auth.signOut()
    }
}
