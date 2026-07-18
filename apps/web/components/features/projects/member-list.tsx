"use client";

import { useActionState } from "react";
import {
  removeMember,
  updateMemberRole,
  type MemberActionState,
} from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { AgentIndicator } from "./agent-indicator";

const ROLES = ["owner", "member", "viewer"] as const;

export type MemberListItem = {
  userId: string;
  role: string;
  displayName: string;
  isAgent: boolean;
};

// Membership admin list (spec/features.md "Team Collaboration"). Role change
// and removal go through the change_member_role / remove_member RPCs, whose
// last-owner-invariant errors are surfaced inline per row (spec/ux-principles.md
// #2) instead of throwing an error page. Viewers/members see a static list.
export function MemberList({
  projectId,
  members,
  currentUserId,
  canManage,
}: {
  projectId: string;
  members: MemberListItem[];
  currentUserId: string | undefined;
  canManage: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {members.map((member) => (
        <MemberRow
          key={member.userId}
          projectId={projectId}
          member={member}
          isSelf={member.userId === currentUserId}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

function MemberRow({
  projectId,
  member,
  isSelf,
  canManage,
}: {
  projectId: string;
  member: MemberListItem;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState<MemberActionState, FormData>(
    updateMemberRole,
    {},
  );
  const [removeState, removeAction, removePending] = useActionState<MemberActionState, FormData>(
    removeMember,
    {},
  );
  const error = roleState.error ?? removeState.error;

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm">
          <span>{member.displayName}</span>
          {member.isAgent && <AgentIndicator />}
          {isSelf && <span className="ml-1 text-muted-foreground">(you)</span>}
        </span>

        {canManage ? (
          <div className="flex items-center gap-2">
            <form action={roleAction} className="flex items-center gap-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="user_id" value={member.userId} />
              <NativeSelect
                name="role"
                defaultValue={member.role}
                aria-label={`Role for ${member.displayName}`}
                className="h-8 w-auto"
                disabled={rolePending}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" variant="outline" size="sm" disabled={rolePending}>
                Save
              </Button>
            </form>
            <form action={removeAction}>
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="user_id" value={member.userId} />
              <Button type="submit" variant="destructive" size="sm" disabled={removePending}>
                {isSelf ? "Leave" : "Remove"}
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{member.role}</span>
            {/* Non-owners can leave the project themselves (remove_member
                allows self-leave) — the last owner is guarded by the RPC. */}
            {isSelf && (
              <form action={removeAction}>
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="user_id" value={member.userId} />
                <Button type="submit" variant="outline" size="sm" disabled={removePending}>
                  Leave
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
