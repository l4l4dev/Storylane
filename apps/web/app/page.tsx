import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // TASK-104 (doc-11 D2): signed-in users land on My Work, not the projects
  // list — it's the personal-todo + cross-project home now.
  redirect(user ? "/my-work" : "/auth/login");
}
