import { Skeleton } from "@/components/ui/skeleton";

export default function ActivityLoading() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Skeleton className="mb-6 h-8 w-24" />
      <ul className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </ul>
    </main>
  );
}
