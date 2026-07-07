import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role Supabase client — bypasses RLS. Server-only: must never be
 * imported from a client component (`SUPABASE_SERVICE_ROLE_KEY` has no
 * NEXT_PUBLIC prefix, so the key is absent from client bundles and this
 * throws rather than silently running with undefined).
 *
 * Only for reads/writes that legitimately cross the acting user's RLS
 * boundary — currently just the Slack notify helper
 * (lib/integrations/slack.ts), which must read the owner-only
 * `integrations` row while a plain member's action triggers the
 * notification. Everything else keeps using `createClient` (lib/supabase/
 * server.ts) so RLS stays in force.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
