// Task 12: Slack notification sender (see spec/integrations.md — sent
// directly from server actions via this shared helper, not an Edge
// Function; 2026-07-07 decision). Server-only: reads the owner-only
// `integrations` row through the service-role client since the acting user
// may be a plain member.

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Posts `text` to the project's Slack Incoming Webhook, if an active slack
 * integration exists. Fire-and-forget by design: failures are logged and
 * swallowed so a Slack outage can never fail the user's action — call this
 * via `after()` (next/server) so it runs once the response is sent.
 */
export async function notifySlack(projectId: string, text: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { data: integration } = await supabase
      .from("integrations")
      .select("config, is_active")
      .eq("project_id", projectId)
      .eq("provider", "slack")
      .maybeSingle();

    if (!integration?.is_active) {
      return;
    }
    const webhookUrl = (integration.config as { webhook_url?: string }).webhook_url;
    if (!webhookUrl) {
      return;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      console.error(`Slack notification failed: ${response.status}`);
    }
  } catch (error) {
    console.error("Slack notification failed:", error);
  }
}
