"use client";
import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";
export default function GlobalErrorBoundary(props: Omit<RouteErrorProps, "message">) {
  return <RouteError {...props} message="Something went wrong loading this page." />;
}
