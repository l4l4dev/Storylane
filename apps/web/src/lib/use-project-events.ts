import { useEffect, useRef } from "react";

/**
 * Invalidation only: the server sends no payload, so every event means "refetch what you show"
 * (design §6). EventSource reconnects by itself, and heartbeat comment frames keep proxies from
 * closing an idle stream.
 *
 * `onChange` is held in a ref and the effect depends on the project alone: the caller's handler
 * identity changes on every completed reload (use-resource's `reload` closes over its nonce), and
 * an effect that watched it would tear the stream down and reopen it after every single event.
 *
 * A reconnect is also treated as a change: whatever the client missed while the stream was down
 * arrives as nothing at all, so the only safe assumption on `open` is that the view is stale.
 */
export function useProjectEvents(projectId: string | null, onChange: () => void): void {
  const handlerRef = useRef(onChange);
  // Assigned in an effect, not during render (react-hooks/refs): an event landing in the gap
  // would only run the previous render's handler, which refetches just the same.
  useEffect(() => {
    handlerRef.current = onChange;
  });
  useEffect(() => {
    if (projectId === null || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/projects/${projectId}/events`, { withCredentials: true });
    const handler = () => handlerRef.current();
    source.addEventListener("project.changed", handler);
    source.addEventListener("open", handler);
    return () => {
      source.removeEventListener("project.changed", handler);
      source.removeEventListener("open", handler);
      source.close();
    };
  }, [projectId]);
}
