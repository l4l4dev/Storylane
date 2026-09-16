import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectPage } from "./ProjectPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ProjectPage", () => {
  it("shows the project name it fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "p1", name: "Apollo", archivedAt: null, role: "owner" }));
    render(<ProjectPage projectId="p1" />);
    expect(await screen.findByRole("heading", { name: "Apollo" })).toBeInTheDocument();
  });

  it("reports a project it may not read", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(404, { error: "not_found" }));
    render(<ProjectPage projectId="p1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/gone, or was never yours/i);
  });
});
