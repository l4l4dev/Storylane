"use client";

import { useState } from "react";
import { searchUserForNewProject, type NewProjectInviteResult } from "@/app/dashboard/actions";
import { Input } from "@/components/ui/input";

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
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    const trimmed = query.trim();
    if (!trimmed || pending) {
      return;
    }
    setPending(true);
    setNotFound(false);
    const found = await searchUserForNewProject(trimmed);
    setPending(false);
    if (!found) {
      setNotFound(true);
      return;
    }
    if (!selected.some((u) => u.id === found.id)) {
      onChange([...selected, found]);
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
      <Input
        type="text"
        aria-label="Add member by exact username"
        placeholder="Exact username, then Enter…"
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleSubmit();
          }
        }}
      />
      {notFound && <p className="text-sm text-muted-foreground">No user found with that exact username.</p>}
    </div>
  );
}
