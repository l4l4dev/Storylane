import Foundation

/// Supabase configuration injected from `Config.xcconfig` via Info.plist.
enum SupabaseConfig {
    static let url: URL = {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
            let url = URL(string: value)
        else {
            fatalError("SUPABASE_URL is missing. Copy Config.xcconfig.example to Config.xcconfig.")
        }
        return url
    }()

    static let publishableKey: String = {
        guard
            let key = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String,
            !key.isEmpty
        else {
            fatalError("SUPABASE_PUBLISHABLE_KEY is missing. Copy Config.xcconfig.example to Config.xcconfig.")
        }
        return key
    }()

    /// OAuth callback registered in Info.plist (CFBundleURLTypes) and Supabase redirect allow-list.
    static let oauthCallback = URL(string: "dev.l4l4.storylane://login-callback")
}
