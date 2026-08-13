import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/lib/database.types";

async function createSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore when middleware
            // is refreshing the session.
          }
        },
      },
    },
  );
}

/**
 * Supabase client for use in Server Components, Route Handlers, and Server
 * Actions. Memoized per request (React cache()) so the several call sites on
 * one request path (layout, page, the cached fetchers below, ...) share one
 * client/cookie jar instead of each constructing their own — cache() is a
 * no-op passthrough outside the RSC render (e.g. in Vitest, see getUser
 * below), so this doesn't change anything under test.
 */
export const createClient = cache(createSupabaseClient);

/**
 * auth.getUser() is an HTTP call to Supabase Auth, not a local read — every
 * layout/page/action on one request path calling it separately turns into
 * several of the same round trip. React's cache() memoizes this per request
 * (it's a no-op passthrough outside the RSC render, e.g. in Vitest, so tests
 * are unaffected — see node_modules/react's client-build cache()).
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});
