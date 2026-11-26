export interface ProjectChanged {
  type: "project.changed";
  projectId: string;
  /** projects.version after the change: a client may fetch activity?since_version= instead of refetching. */
  version: number;
}

type Listener = (event: ProjectChanged) => void;

/**
 * Invalidation only: no payload, no ordering guarantees, no replay (design §6). Scaling past
 * one process would mean replacing this with an external channel — explicitly out of scope.
 */
export class EventBus {
  #listeners = new Map<string, Set<Listener>>();

  subscribe(projectId: string, listener: Listener): () => void {
    const set = this.#listeners.get(projectId) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(projectId, set);
    return () => {
      const current = this.#listeners.get(projectId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.#listeners.delete(projectId);
    };
  }

  publish(projectId: string, version: number): void {
    const event: ProjectChanged = { type: "project.changed", projectId, version };
    for (const listener of [...(this.#listeners.get(projectId) ?? [])]) {
      // One broken stream must not stop the others; the writer's own error handling closes it.
      try {
        listener(event);
      } catch {
        /* ignored on purpose */
      }
    }
  }

  subscriberCount(projectId?: string): number {
    if (projectId !== undefined) return this.#listeners.get(projectId)?.size ?? 0;
    let total = 0;
    for (const set of this.#listeners.values()) total += set.size;
    return total;
  }
}
