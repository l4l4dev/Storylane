import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StoryEpicMenu } from "./story-epic-menu";

const { setStoryParentMock } = vi.hoisted(() => ({
  setStoryParentMock: vi.fn<(input: unknown) => Promise<{ ok: boolean; message?: string }>>(),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  setStoryParent: setStoryParentMock,
}));

describe("StoryEpicMenu", () => {
  it("detaches the story and reports nothing on success", async () => {
    setStoryParentMock.mockResolvedValueOnce({ ok: true });
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<StoryEpicMenu storyId="s1" projectId="p1" epicTitle="Big epic" onError={onError} />);

    await user.click(screen.getByRole("button", { name: /epic actions for this story/i }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from epic" }));

    expect(setStoryParentMock).toHaveBeenCalledWith({ storyId: "s1", projectId: "p1", parentId: null });
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports the RPC's message when it refuses", async () => {
    setStoryParentMock.mockResolvedValueOnce({ ok: false, message: "That epic no longer exists." });
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<StoryEpicMenu storyId="s1" projectId="p1" epicTitle="Big epic" onError={onError} />);

    await user.click(screen.getByRole("button", { name: /epic actions for this story/i }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from epic" }));

    expect(onError).toHaveBeenCalledWith("That epic no longer exists.");
  });

  // setStoryParent can throw (e.g. createClient() failing) rather than resolve
  // to {ok:false} -- previously this became an unhandled rejection inside
  // startTransition and the dropdown just closed with no error shown.
  it("reports an error when setStoryParent rejects outright", async () => {
    setStoryParentMock.mockRejectedValueOnce(new Error("Network error"));
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<StoryEpicMenu storyId="s1" projectId="p1" epicTitle="Big epic" onError={onError} />);

    await user.click(screen.getByRole("button", { name: /epic actions for this story/i }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from epic" }));

    expect(onError).toHaveBeenCalledWith("Network error");
  });
});
