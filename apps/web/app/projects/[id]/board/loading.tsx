import { Skeleton } from "@/components/ui/skeleton";

export default function BoardLoading() {
  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[calc(100dvh-13rem)] w-72 shrink-0 rounded-lg" />
        ))}
      </div>
    </main>
  );
}
