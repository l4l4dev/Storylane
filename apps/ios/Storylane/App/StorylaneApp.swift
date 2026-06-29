import SwiftUI

@main
struct StorylaneApp: App {
    @State private var auth = AuthManager()

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isLoading {
                    ProgressView()
                } else if auth.session != nil {
                    ContentView()
                } else {
                    LoginView()
                }
            }
            .environment(auth)
            .task { await auth.start() }
        }
    }
}
