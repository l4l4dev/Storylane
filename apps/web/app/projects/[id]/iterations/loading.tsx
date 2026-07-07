import { Skeleton } from "@/components/ui/skeleton";

export default function IterationsLoading() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <Skeleton className="mb-4 h-8 w-32" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </main>
  );
}
