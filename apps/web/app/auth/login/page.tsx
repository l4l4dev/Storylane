"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = "github" | "google";

// Fixed local-dev-only account seeded by supabase/seed.sql. Not a real
// secret — it only ever grants access to the throwaway local sandbox DB.
const DEV_USER_EMAIL = "dev@storylane.local";
const DEV_USER_PASSWORD = "dev-local-only-password";

export default function LoginPage() {
  const [loading, setLoading] = useState<Provider | "dev" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setLoading(provider);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
    // On success the browser is redirected to the provider.
  }

  async function signInAsDevUser() {
    setLoading("dev");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: DEV_USER_EMAIL,
      password: DEV_USER_PASSWORD,
    });
    if (error) {
      setError(error.message);
      setLoading(null);
      return;
    }
    window.location.href = "/dashboard";
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold">Storylane</h1>
        <p className="text-sm text-gray-500">Sign in to continue</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={() => signIn("github")}
          disabled={loading !== null}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
        </button>

        <button
          type="button"
          onClick={() => signIn("google")}
          disabled={loading !== null}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          {loading === "google" ? "Redirecting…" : "Continue with Google"}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {process.env.NODE_ENV !== "production" && (
        <div className="flex w-full max-w-xs flex-col gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
          <p className="text-center text-xs text-gray-400">Local development only</p>
          <button
            type="button"
            onClick={() => void signInAsDevUser()}
            disabled={loading !== null}
            className="rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900"
          >
            {loading === "dev" ? "Signing in…" : "Continue as dev user"}
          </button>
        </div>
      )}
    </main>
  );
}
