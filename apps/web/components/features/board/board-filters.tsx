"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STORY_TYPES } from "@/lib/utils/stories";
import { NativeSelect } from "@/components/ui/native-select";

type Option = { id: string; name: string };

export function BoardFilters({
  assignees,
  labels,
}: {
  assignees: Option[];
  labels: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label="Filter by type"
        value={searchParams.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className="h-8 w-auto"
      >
        <option value="">All types</option>
        {STORY_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </NativeSelect>

      <NativeSelect
        aria-label="Filter by assignee"
        value={searchParams.get("assignee") ?? ""}
        onChange={(e) => setParam("assignee", e.target.value)}
        className="h-8 w-auto"
      >
        <option value="">All assignees</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </NativeSelect>

      <NativeSelect
        aria-label="Filter by label"
        value={searchParams.get("label") ?? ""}
        onChange={(e) => setParam("label", e.target.value)}
        className="h-8 w-auto"
      >
        <option value="">All labels</option>
        {labels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
