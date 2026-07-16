"use client";
import { RouteError, type RouteErrorProps } from "@/components/ui/route-error";
export default function StoryDetailErrorBoundary(props: Omit<RouteErrorProps, "message">) {
  return <RouteError {...props} message="Something went wrong loading this story." />;
}
