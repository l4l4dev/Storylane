"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

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
    // TASK-104 (doc-11 D2): land on My Work, not the projects list.
    window.location.href = "/my-work";
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold">Storylane</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button
          variant="outline"
          size="lg"
          onClick={() => signIn("github")}
          disabled={loading !== null}
        >
          {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
        </Button>

        <Button
          variant="outline"
          size="lg"
          onClick={() => signIn("google")}
          disabled={loading !== null}
        >
          {loading === "google" ? "Redirecting…" : "Continue with Google"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {process.env.NODE_ENV !== "production" && (
        <div className="flex w-full max-w-xs flex-col gap-2 border-t border-border pt-4">
          <p className="text-center text-xs text-muted-foreground">Local development only</p>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void signInAsDevUser()}
            disabled={loading !== null}
            className="border-dashed text-muted-foreground"
          >
            {loading === "dev" ? "Signing in…" : "Continue as dev user"}
          </Button>
        </div>
      )}
    </main>
  );
}
