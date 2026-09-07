import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts sets `globals: false`, so @testing-library/react's own auto-cleanup (which
// looks for a global afterEach) never registers — do it explicitly instead.
afterEach(cleanup);
