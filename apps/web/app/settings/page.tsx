import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appVersion } from "@/lib/utils/app-version";
import { ProfileSettingsForm } from "@/components/features/settings/profile-settings-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", user.id)
    .single();

  if (!profile) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="mb-6">
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Account settings</h1>
      </div>

      <ProfileSettingsForm username={profile.username} displayName={profile.display_name} />

      <p className="mt-10 text-xs text-muted-foreground">Storylane {appVersion()}</p>
    </main>
  );
}
