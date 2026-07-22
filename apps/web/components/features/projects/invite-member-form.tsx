"use client";

import { useActionState, useEffect, useState } from "react";
import {
  inviteMember,
  searchUsersForInvite,
  type InviteSearchResult,
  type InviteState,
} from "@/app/projects/[id]/settings/actions";
import { useDebouncedCallback } from "@/lib/utils/use-debounced-callback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

// Invite by user search (spec/features.md "Team Collaboration"). Search
// results are debounced client-side; the 2-char minimum, the cap, and
// excluding already-invited users are all enforced server-side by
// search_users_for_invite itself.
export function InviteMemberForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    inviteMember,
    {},
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InviteSearchResult[]>([]);
  const [selected, setSelected] = useState<InviteSearchResult | null>(null);
  const debounce = useDebouncedCallback(300);

  useEffect(() => {
    debounce.cancel();
    if (query.trim().length < 2) {
      return;
    }
    // A slower earlier query can resolve after a faster later one; `cancelled`
    // is set by this effect's own cleanup (fired on the next keystroke) so a
    // stale response can never overwrite a fresher one.
    let cancelled = false;
    debounce.trigger(async () => {
      const found = await searchUsersForInvite(projectId, query);
      if (!cancelled) setResults(found);
    });
    return () => {
      cancelled = true;
      debounce.cancel();
    };
  }, [query, projectId, debounce]);

  // Derived rather than reset via setState in the effect above: avoids a
  // cascading-render lint violation and means a query shortened back below
  // 2 chars hides stale results immediately, without waiting on an effect.
  const visibleResults = query.trim().length < 2 ? [] : results;

  function selectUser(user: InviteSearchResult) {
    setSelected(user);
    setQuery("");
    setResults([]);
  }

  return (
    <form
      action={formAction}
      onSubmit={() => {
        setSelected(null);
        setQuery("");
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="user_id" value={selected?.id ?? ""} />
      <input type="hidden" name="display_name" value={selected?.displayName ?? ""} />

      <div className="flex flex-wrap items-center gap-2">
        {selected ? (
          <span className="flex flex-1 items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-sm">
            {selected.displayName}
            <span className="text-muted-foreground">@{selected.username}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label={`Remove ${selected.displayName}`}
              className="ml-1 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ) : (
          <div className="relative flex-1">
            <Input
              type="text"
              aria-label="Search users to invite"
              placeholder="Search by username or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {visibleResults.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
                {visibleResults.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => selectUser(user)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      {user.displayName}{" "}
                      <span className="text-muted-foreground">@{user.username}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <NativeSelect name="role" defaultValue="member" className="w-auto">
          <option value="member">member</option>
          <option value="viewer">viewer</option>
          <option value="owner">owner</option>
        </NativeSelect>
        <Button type="submit" disabled={pending || !selected}>
          {pending ? "Inviting…" : "Invite"}
        </Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p className="text-sm text-primary">{state.success}</p>}
    </form>
  );
}
