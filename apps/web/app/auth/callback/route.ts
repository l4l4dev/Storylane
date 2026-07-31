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
  // redirect chain. An explicit `next` (deep link) wins when it validates.
  //
  // `next` is appended straight onto `origin`, so anything without a leading
  // `/` can smuggle a userinfo separator in front of the first `/` — a value
  // like `@evil.example/x` turns `${origin}${next}` into
  // `https://storylane.example@evil.example/x`, which browsers parse with
  // evil.example as the host, storylane.example discarded as ignored
  // userinfo. A leading `/` closes that: whatever comes after it is
  // unambiguously the path, not a new authority.
  const rawNext = searchParams.get("next");
  const next = rawNext && /^\/(?!\/|\\)/.test(rawNext) ? rawNext : "/my-work";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth`);
}
