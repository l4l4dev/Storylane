"use client";

import { useRouter } from "next/navigation";
import { createEpic } from "@/app/projects/[id]/board/actions";
import { AddEpicButton } from "@/components/features/epics/add-epic-button";

// Navigates to the new epic on success (ux-principles principle 10: "a
// successful create lands the user in the thing they created") — the List
// view's own "+ Add Epic" instead expands the band in place, since /epics
// has no equivalent collapsed state to open.
export function EpicsPageAddButton({ projectId }: { projectId: string }) {
  const router = useRouter();

  async function handleCreate(title: string) {
    const result = await createEpic({ projectId, title });
    if (!result.ok) {
      throw new Error(result.message);
    }
    router.push(`/projects/${projectId}/epics?epic=${result.id}`);
  }

  return <AddEpicButton onCreate={handleCreate} />;
}
