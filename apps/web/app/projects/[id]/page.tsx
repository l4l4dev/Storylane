import { redirect } from "next/navigation";

// The board is the project's home view (see spec/screens.md "Navigation") —
// this route only exists so links to the bare project id land somewhere.
export default async function ProjectRootPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/board`);
}
