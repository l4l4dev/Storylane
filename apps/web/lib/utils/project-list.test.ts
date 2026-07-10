import { describe, expect, it } from "vitest";
import { filterAndSortProjects, type ProjectListItem } from "./project-list";

function item(overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: "p1",
    name: "Alpha",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isFavorite: false,
    isArchived: false,
    ...overrides,
  };
}

describe("filterAndSortProjects", () => {
  it("hides archived projects by default (showArchived: false)", () => {
    const projects = [item({ id: "a", isArchived: false }), item({ id: "b", isArchived: true })];
    const result = filterAndSortProjects(projects, { search: "", sort: "updated", showArchived: false });
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });

  it("shows archived projects when showArchived is true", () => {
    const projects = [item({ id: "a", isArchived: false }), item({ id: "b", isArchived: true })];
    const result = filterAndSortProjects(projects, { search: "", sort: "updated", showArchived: true });
    expect(result.map((p) => p.id)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(result).toHaveLength(2);
  });

  it("filters by a case-insensitive name substring match", () => {
    const projects = [item({ id: "a", name: "Storylane Web" }), item({ id: "b", name: "Other Project" })];
    const result = filterAndSortProjects(projects, { search: "storylane", sort: "updated", showArchived: false });
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });

  it("sorts favorites first regardless of the chosen sort key", () => {
    const projects = [
      item({ id: "a", name: "Zeta", isFavorite: false }),
      item({ id: "b", name: "Beta", isFavorite: true }),
    ];
    const result = filterAndSortProjects(projects, { search: "", sort: "name", showArchived: false });
    expect(result.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("sorts by name A-Z when sort is 'name'", () => {
    const projects = [item({ id: "a", name: "Zeta" }), item({ id: "b", name: "Beta" })];
    const result = filterAndSortProjects(projects, { search: "", sort: "name", showArchived: false });
    expect(result.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("sorts by createdAt descending when sort is 'created'", () => {
    const projects = [
      item({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }),
      item({ id: "b", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    const result = filterAndSortProjects(projects, { search: "", sort: "created", showArchived: false });
    expect(result.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("sorts by updatedAt descending when sort is 'updated' (default)", () => {
    const projects = [
      item({ id: "a", updatedAt: "2026-01-01T00:00:00.000Z" }),
      item({ id: "b", updatedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    const result = filterAndSortProjects(projects, { search: "", sort: "updated", showArchived: false });
    expect(result.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
