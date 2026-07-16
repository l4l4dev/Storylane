"use client";
import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";
export default function ProjectPageErrorBoundary(props: Omit<RouteErrorProps, "message">) {
  return <RouteError {...props} compact message="Something went wrong loading this view." />;
}
