import { Skeleton } from "@/components/ui/skeleton";

export default function BoardLoading() {
  return (
    <main className="p-6" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Loading board
      </span>
      <div className="mb-4">
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex max-w-3xl flex-col gap-6">
        {Array.from({ length: 2 }).map((_, section) => (
          <section key={section} className="flex flex-col gap-2">
            <div className="flex items-center gap-3 py-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-px flex-1" />
            </div>
            {Array.from({ length: section === 0 ? 3 : 4 }).map((_, row) => (
              <Skeleton key={row} className="h-9 w-full rounded-lg" />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
