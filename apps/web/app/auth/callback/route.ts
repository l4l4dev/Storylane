import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback: exchanges the authorization code for a session, then
 * redirects to the originally requested page (or the home page).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // TASK-104 (doc-11 D2): default landing is My Work, not the home page's own
  // redirect chain. An explicit `next` (deep link) still wins — that branch
  // is unchanged.
  const next = searchParams.get("next") ?? "/my-work";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth`);
}
