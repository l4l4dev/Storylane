import { Skeleton } from "@/components/ui/skeleton";

export default function EpicsLoading() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </ul>
    </main>
  );
}
