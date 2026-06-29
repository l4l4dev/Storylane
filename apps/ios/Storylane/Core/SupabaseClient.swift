import Foundation
import Supabase

/// Shared Supabase client. Sessions are persisted automatically (Keychain) and
/// restored on launch by the SDK.
let supabase = SupabaseClient(
    supabaseURL: SupabaseConfig.url,
    supabaseKey: SupabaseConfig.publishableKey
)
