import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsernameEditor } from "./username-editor";

describe("UsernameEditor", () => {
  it("pre-fills the input with the current username", () => {
    render(<UsernameEditor username="dev_user" />);
    expect(screen.getByRole("textbox")).toHaveValue("dev_user");
  });

  it("renders a save button", () => {
    render(<UsernameEditor username="dev_user" />);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
