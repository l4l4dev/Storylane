"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  message: string;
  compact?: boolean;
};

export function RouteError({ error, reset, message, compact = false }: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const content = <ErrorState message={message} onRetry={reset} />;
  return compact ? (
    <div className="flex min-h-[60vh] items-center justify-center p-6">{content}</div>
  ) : (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center p-6">{content}</main>
  );
}
