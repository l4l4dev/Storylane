import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";

/**
 * Vercel Cron ping to keep the Supabase project out of its free-tier
 * auto-pause window (paused after 7 days with no API activity).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The anon role has no grants in this schema (every table is authenticated-
  // only, see supabase/migrations/20260630000002_grants.sql) — this route is
  // server-only and secret-gated above, so the service role key is the
  // correct credential rather than widening anon's grants just for a ping.
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { error } = await supabase.from("profiles").select("id").limit(1);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
