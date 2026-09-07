import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectsPage } from "./ProjectsPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const list = [
  { id: "p1", name: "Live one", archivedAt: null, role: "owner" },
  { id: "p2", name: "Old one", archivedAt: 1_700_000_000_000, role: "member" },
];

describe("ProjectsPage", () => {
  it("groups archived projects in their own section below the active ones", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, list));
    render(<ProjectsPage onOpen={vi.fn()} />);
    expect(await screen.findByRole("link", { name: /live one/i })).toBeInTheDocument();
    const archivedHeading = screen.getByRole("heading", { name: /archived/i });
    expect(archivedHeading).toBeInTheDocument();
    // The archived project must render after the heading, never interleaved (principle 9).
    expect(archivedHeading.compareDocumentPosition(screen.getByRole("link", { name: /old one/i }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("opens the project it just created (principle 10)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(201, { id: "p9", name: "Fresh", archivedAt: null, role: "owner" }));
    const onOpen = vi.fn();
    render(<ProjectsPage onOpen={onOpen} />);
    await screen.findByRole("button", { name: /create project/i });
    await userEvent.type(screen.getByLabelText(/project name/i), "Fresh");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("p9"));
    expect(JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string)).toEqual({ name: "Fresh" });
  });

  it("reports a failed create in place", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(400, { error: "name_required" }));
    render(<ProjectsPage onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: /create project/i });
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/name is required/i);
  });
});
