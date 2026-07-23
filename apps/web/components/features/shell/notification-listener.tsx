"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNotificationsRealtime } from "@/lib/supabase/realtime";
import type { NotificationContent } from "@/lib/utils/notifications";

function showBrowserNotification({ title, body }: NotificationContent) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

// Mounted once in the root layout so it's active on every authenticated
// page, not just the board. Requests permission as soon
// as a session is found — in practice that's right after sign-in, since both
// the OAuth callback and the dev-login button do a full page navigation
// (see app/auth/login/page.tsx), so this component mounts fresh at that
// point rather than needing an auth-state-change listener. Renders nothing;
// `useNotificationsRealtime` (lib/supabase/realtime.ts) supplies the two
// triggers (assigned to a story / a story you own changes state / mentioned
// in a comment — spec/features.md).
export function NotificationListener() {
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) {
        return;
      }
      setUserId(user.id);

      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }

      const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single();
      if (!cancelled && profile) {
        setUsername(profile.username);
      }
    }
    void loadUser();

    return () => {
      cancelled = true;
    };
  }, []);

  useNotificationsRealtime(userId, username, showBrowserNotification);

  return null;
}
