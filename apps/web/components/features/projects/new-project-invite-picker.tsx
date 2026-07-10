"use client";

import { useState } from "react";
import { searchUserForNewProject, type NewProjectInviteResult } from "@/app/dashboard/actions";
import { Input } from "@/components/ui/input";

// Matches createProject's server-side cap (apps/web/app/dashboard/actions.ts)
// so a 21st+ selection is refused client-side instead of being silently
// dropped on submit (TASK-25 follow-up).
const MAX_INVITEES = 20;

// TASK-7: initial-invite picker for the project-creation panel, usable
// before a project row exists. Deliberately not InviteMemberForm's fuzzy
// dropdown — see new-project-invite-picker's backing RPC
// (search_users_for_new_project) for why only an exact-match, Enter-to-add
// flow is safe pre-project (spec/screens.md "Projects page").
export function NewProjectInvitePicker({
  selected,
  onChange,
}: {
  selected: NewProjectInviteResult[];
  onChange: (users: NewProjectInviteResult[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ kind: "not_found" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const atCap = selected.length >= MAX_INVITEES;

  async function handleSubmit() {
    const trimmed = query.trim();
    if (!trimmed || pending || atCap) {
      return;
    }
    setPending(true);
    setMessage(null);
    const result = await searchUserForNewProject(trimmed);
    setPending(false);
    if (result.status === "error") {
      setMessage({ kind: "error", text: `Search failed: ${result.message}` });
      return;
    }
    if (result.status === "not_found") {
      setMessage({ kind: "not_found", text: "No user found with that exact username." });
      return;
    }
    if (!selected.some((u) => u.id === result.user.id)) {
      onChange([...selected, result.user]);
    }
    setQuery("");
  }

  function removeUser(id: string) {
    onChange(selected.filter((u) => u.id !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {selected.map((user) => (
          <span
            key={user.id}
            className="flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-sm"
          >
            {user.displayName} <span className="text-muted-foreground">@{user.username}</span>
            <button
              type="button"
              onClick={() => removeUser(user.id)}
              aria-label={`Remove ${user.displayName}`}
              className="ml-1 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {atCap ? (
        <p className="text-sm text-muted-foreground">Maximum of 20 initial invites reached.</p>
      ) : (
        <Input
          type="text"
          aria-label="Add member by exact username"
          placeholder="Exact username, then Enter…"
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setMessage(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
      )}
      {message && (
        <p
          className={
            message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
