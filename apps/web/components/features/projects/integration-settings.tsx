import { deleteIntegration, saveIntegration } from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type IntegrationRow = {
  id: string;
  provider: string;
  // webhook_secret is never returned to the client (TASK-63) — it lives in its
  // own non-SELECTable column, not here.
  config: { repo_url?: string; webhook_url?: string };
  is_active: boolean;
};

// Per-provider integration forms (see spec/integrations.md). Rendered
// only for project owners — the integrations RLS is owner-only
// since config holds secrets. Plain forms + server actions, so this stays
// a Server Component.
export function IntegrationSettings({
  projectId,
  integrations,
  functionsBaseUrl,
}: {
  projectId: string;
  integrations: IntegrationRow[];
  // e.g. `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1` — shown so the owner can
  // copy the exact webhook URL into GitHub/Forgejo repo settings.
  functionsBaseUrl: string;
}) {
  const byProvider = new Map(integrations.map((integration) => [integration.provider, integration]));
  const webhookUrl = `${functionsBaseUrl}/git-webhook?project=${projectId}`;

  return (
    <div className="flex flex-col gap-6">
      {(["github", "forgejo"] as const).map((provider) => {
        const existing = byProvider.get(provider);
        return (
          <form key={provider} action={saveIntegration} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="provider" value={provider} />
            <div className="flex items-center justify-between">
              <h3 className="font-medium capitalize">{provider}</h3>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={existing?.is_active ?? true} />
                Active
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Webhook URL (add this to the repo&apos;s webhook settings, content type JSON):{" "}
              <code className="break-all rounded bg-muted px-1 py-0.5">{webhookUrl}</code>
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${provider}-repo-url`}>Repository URL</Label>
              <Input
                id={`${provider}-repo-url`}
                name="repo_url"
                type="url"
                placeholder="https://github.com/you/repo"
                defaultValue={existing?.config.repo_url ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${provider}-webhook-secret`}>Webhook secret</Label>
              {/* Set/rotate only — the stored secret is never sent to the client
                  (TASK-63). Blank on an existing integration keeps it. */}
              <Input
                id={`${provider}-webhook-secret`}
                name="webhook_secret"
                type="password"
                placeholder={existing ? "Leave blank to keep the current secret" : "Same secret as configured on the repo webhook"}
                required={!existing}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" variant="outline" size="sm">
                Save
              </Button>
              {existing && (
                <Button
                  type="submit"
                  formAction={deleteIntegration}
                  name="integration_id"
                  value={existing.id}
                  variant="destructive"
                  size="sm"
                >
                  Remove
                </Button>
              )}
            </div>
          </form>
        );
      })}

      {(() => {
        const existing = byProvider.get("slack");
        return (
          <form action={saveIntegration} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="provider" value="slack" />
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Slack</h3>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={existing?.is_active ?? true} />
                Active
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Notifies the channel on story state changes and iteration completion.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slack-webhook-url">Incoming Webhook URL</Label>
              <Input
                id="slack-webhook-url"
                name="webhook_url"
                type="url"
                placeholder="https://hooks.slack.com/services/…"
                defaultValue={existing?.config.webhook_url ?? ""}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" variant="outline" size="sm">
                Save
              </Button>
              {existing && (
                <Button
                  type="submit"
                  formAction={deleteIntegration}
                  name="integration_id"
                  value={existing.id}
                  variant="destructive"
                  size="sm"
                >
                  Remove
                </Button>
              )}
            </div>
          </form>
        );
      })()}
    </div>
  );
}
