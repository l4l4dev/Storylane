import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const RUN = process.env.SUPABASE_INTEGRATION === "1";

const DEV_USER_ID = "11111111-1111-1111-1111-111111111111";

function anonClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      process.loadEnvFile(`${process.cwd()}/.env.local`);
    } catch {
      // The missing-env assertion below reports the actionable failure.
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }

  return createClient(url, anonKey, { auth: { persistSession: false } });
}

async function signedInClient() {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: "dev@storylane.local",
    password: "dev-local-only-password",
  });
  if (error) throw error;
  return client;
}

describe.skipIf(!RUN)("profiles.is_agent (integration)", () => {
  it("is readable through the existing authenticated profile policy and defaults to false", async () => {
    const client = anonClient();
    const { data: anonymousData, error: anonymousError } = await client
      .from("profiles")
      .select("is_agent")
      .eq("id", DEV_USER_ID)
      .maybeSingle();

    expect(anonymousError?.code).toBe("42501");
    expect(anonymousData).toBeNull();

    const { error: signInError } = await client.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (signInError) throw signInError;

    const { data, error } = await client
      .from("profiles")
      .select("is_agent")
      .eq("id", DEV_USER_ID)
      .single();

    expect(error).toBeNull();
    expect(data?.is_agent).toBe(false);
  });

  it("rejects a user setting is_agent on their own row (column not in the UPDATE grant)", async () => {
    const client = await signedInClient();

    const { error } = await client
      .from("profiles")
      .update({ is_agent: true })
      .eq("id", DEV_USER_ID);
    expect(error?.code).toBe("42501");

    const { data } = await client
      .from("profiles")
      .select("is_agent")
      .eq("id", DEV_USER_ID)
      .single();
    expect(data?.is_agent).toBe(false);
  });

  it("still allows the profile-settings columns through the replacement column grant", async () => {
    const client = await signedInClient();

    const { data, error } = await client
      .from("profiles")
      .update({ display_name: "Dev User" })
      .eq("id", DEV_USER_ID)
      .select("display_name")
      .single();

    expect(error).toBeNull();
    expect(data?.display_name).toBe("Dev User");
  });
});
