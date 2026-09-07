import { useEffect } from "react";

/**
 * Invalidation only: the server sends no payload, so every event means "refetch what you show"
 * (design §6). EventSource reconnects by itself, and heartbeat comment frames keep proxies from
 * closing an idle stream.
 */
export function useProjectEvents(projectId: string | null, onChange: () => void): void {
  useEffect(() => {
    if (projectId === null || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/projects/${projectId}/events`, { withCredentials: true });
    const handler = () => onChange();
    source.addEventListener("project.changed", handler);
    return () => {
      source.removeEventListener("project.changed", handler);
      source.close();
    };
  }, [projectId, onChange]);
}
