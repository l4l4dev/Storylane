"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STORY_TYPES } from "@/lib/utils/stories";

type Option = { id: string; name: string };

export function BacklogFilters({
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

  const selectClass =
    "rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-zinc-800";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by type"
        value={searchParams.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className={selectClass}
      >
        <option value="">All types</option>
        {STORY_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by assignee"
        value={searchParams.get("assignee") ?? ""}
        onChange={(e) => setParam("assignee", e.target.value)}
        className={selectClass}
      >
        <option value="">All assignees</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by label"
        value={searchParams.get("label") ?? ""}
        onChange={(e) => setParam("label", e.target.value)}
        className={selectClass}
      >
        <option value="">All labels</option>
        {labels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
