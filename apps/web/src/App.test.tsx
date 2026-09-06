import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

describe("App shell", () => {
  it("shows the server status from /healthz", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/server: ok/i)).toBeInTheDocument());
  });
  it("shows unavailable when /healthz fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/server: unavailable/i)).toBeInTheDocument());
  });
});
