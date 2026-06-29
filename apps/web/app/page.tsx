import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated users; this is a safeguard.
  if (!user) {
    redirect("/auth/login");
  }

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/auth/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">Storylane</h1>
      <p className="text-sm text-gray-500">Signed in as {user.email}</p>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
