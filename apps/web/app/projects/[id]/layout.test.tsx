import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectLayout from "./layout";

// TASK-147: this layout is the ONE choke point every /projects/[id]/* page
// shares — sealing the hidden personal project here (redirect to /my-work)
// covers board/iterations/epics/activity/settings/the bare-id page in one
// place. Follows this repo's established REDIRECT:<url> throw-marker
// convention (app/dashboard/actions.test.ts) since next/navigation's real
// redirect() throws a special signal Next.js itself catches.
let projectRow: { id: string; name: string; is_personal: boolean; created_by: string | null } | null;
const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: projectRow, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/sidebar-data", () => ({
  fetchSidebarData: async () => ({ projects: [], username: "dev" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/projects/p1/board",
}));

describe("ProjectLayout", () => {
  it("redirects the viewer's own personal project to /my-work", async () => {
    projectRow = { id: "p1", name: "My Tasks", is_personal: true, created_by: "user-1" };
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    await expect(
      ProjectLayout({ children: <div />, params: Promise.resolve({ id: "p1" }) }),
    ).rejects.toThrow("REDIRECT:/my-work");
  });

  it("renders normally for a non-personal project", async () => {
    projectRow = { id: "p1", name: "Team Alpha", is_personal: false, created_by: "user-1" };
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    render(await ProjectLayout({ children: <div>content</div>, params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  // Defensive: doc-15/TASK-147 make this unreachable in practice (no one else
  // can ever be a member of a personal project), but the layout's own
  // condition is scoped to the viewer's OWN personal project on purpose — an
  // invited member (if one somehow existed) must not be redirected away from
  // a project that isn't theirs.
  it("does not redirect when is_personal is true but the viewer isn't its creator", async () => {
    projectRow = { id: "p1", name: "My Tasks", is_personal: true, created_by: "someone-else" };
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    render(await ProjectLayout({ children: <div>content</div>, params: Promise.resolve({ id: "p1" }) }));
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("404s when the project doesn't exist", async () => {
    projectRow = null;
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    await expect(
      ProjectLayout({ children: <div />, params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow("NOTFOUND");
  });
});
