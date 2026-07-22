import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyWorkMappingBrokenBanner } from "./my-work-mapping-broken-banner";

describe("MyWorkMappingBrokenBanner", () => {
  it("renders nothing when there are no broken projects", () => {
    const { container } = render(<MyWorkMappingBrokenBanner projects={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one line per broken project, each linking to that project's Settings", () => {
    render(
      <MyWorkMappingBrokenBanner
        projects={[
          { id: "p1", name: "Alpha" },
          { id: "p2", name: "Bravo" },
        ]}
      />,
    );
    expect(screen.getByText(/Alpha.*Doing\/Done sync is no longer valid/)).toBeInTheDocument();
    expect(screen.getByText(/Bravo.*Doing\/Done sync is no longer valid/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /reconfigure in settings/i });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/projects/p1/settings",
      "/projects/p2/settings",
    ]);
  });
});
