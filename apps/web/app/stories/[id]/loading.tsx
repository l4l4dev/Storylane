import { Skeleton } from "@/components/ui/skeleton";

export default function StoryDetailLoading() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-6 h-8 w-64" />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8">
        <div className="flex flex-col gap-4 lg:order-2">
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex flex-col gap-4 lg:order-1">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </main>
  );
}
