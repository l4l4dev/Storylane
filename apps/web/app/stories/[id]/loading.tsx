import { Skeleton } from "@/components/ui/skeleton";

export default function StoryDetailLoading() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-6 h-8 w-64" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </main>
  );
}
