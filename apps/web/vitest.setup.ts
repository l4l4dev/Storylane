import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom has no layout engine, so it doesn't implement scrollIntoView at all
// (not even as a no-op) — components that call it (e.g. draft-story-card.tsx)
// would throw in every test that mounts them otherwise.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
