import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Signs the bot in as an ordinary Supabase user (spec/mcp.md "Auth
 * decision"): password auth with the anon key, no service-role key, so every
 * read/write below is gated by the same RLS the Web and iOS clients obey.
 * `persistSession: false` keeps nothing on disk; `autoRefreshToken` refreshes
 * the access token in memory for the life of the stdio process.
 */
export async function createAgentClient(): Promise<SupabaseClient> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const email = process.env.AGENT_EMAIL;
  const password = process.env.AGENT_PASSWORD;

  if (!url || !anonKey || !email || !password) {
    throw new Error(
      "Missing credentials — set SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL and AGENT_PASSWORD in apps/mcp/.env.local (see .env.local.example).",
    );
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Agent sign-in failed for ${email}: ${error.message}`);
  }

  return supabase;
}
