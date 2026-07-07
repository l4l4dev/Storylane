"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

export default function ProjectPageErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <ErrorState message="Something went wrong loading this view." onRetry={reset} />
    </div>
  );
}
