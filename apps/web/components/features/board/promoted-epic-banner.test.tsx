import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parsePromotedEpic, PromotedEpicBanner } from "./promoted-epic-banner";

describe("parsePromotedEpic", () => {
  it("parses a valid id/name pair", () => {
    expect(parsePromotedEpic("e1", "Checkout revamp")).toEqual({ id: "e1", name: "Checkout revamp" });
  });

  it("returns null when either param is missing", () => {
    expect(parsePromotedEpic(undefined, "Checkout revamp")).toBeNull();
    expect(parsePromotedEpic("e1", undefined)).toBeNull();
    expect(parsePromotedEpic(undefined, undefined)).toBeNull();
  });
});

describe("PromotedEpicBanner", () => {
  it("names the epic and links to it on the epics page", () => {
    render(<PromotedEpicBanner projectId="p1" epicId="e1" epicName="Checkout revamp" />);
    expect(screen.getByText(/Checkout revamp/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View epic" })).toHaveAttribute(
      "href",
      "/projects/p1/epics#e1",
    );
  });
});
