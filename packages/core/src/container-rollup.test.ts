import { describe, expect, it } from "vitest";
import { rollupContainer, type RollupChild, type ContainerRollup } from "./container-rollup";
import fixture from "../../../spec/fixtures/container-rollup.json";

type Case = { label: string; children: RollupChild[]; expected: ContainerRollup };
const cases = (fixture as unknown as { cases: Case[] }).cases;

describe("rollupContainer — doc-18 §5 golden fixture", () => {
  it.each(cases)("$label", ({ children, expected }) => {
    expect(rollupContainer(children)).toEqual(expected);
  });
});
