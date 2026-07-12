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

  // TASK-32: a project archived just now has its updatedAt bumped to "now"
  // too, so without an archived-last rule it would jump to the top of a
  // "Last updated" sort, mixed in above active projects.
  it("sorts archived projects after all active ones even when the archived one was updated most recently", () => {
    const projects = [
      item({ id: "active", updatedAt: "2026-01-01T00:00:00.000Z", isArchived: false }),
      item({ id: "just-archived", updatedAt: "2026-07-11T00:00:00.000Z", isArchived: true }),
    ];
    const result = filterAndSortProjects(projects, { search: "", sort: "updated", showArchived: true });
    expect(result.map((p) => p.id)).toEqual(["active", "just-archived"]);
  });

  it("keeps archived-last even ahead of favorite ordering (a favorite active project outranks an archived one)", () => {
    const projects = [
      item({ id: "archived-favorite", isFavorite: true, isArchived: true }),
      item({ id: "active-non-favorite", isFavorite: false, isArchived: false }),
    ];
    const result = filterAndSortProjects(projects, { search: "", sort: "updated", showArchived: true });
    expect(result.map((p) => p.id)).toEqual(["active-non-favorite", "archived-favorite"]);
  });

  it("still sorts favorites first within each of the active/archived groups", () => {
    const projects = [
      item({ id: "active-a", isFavorite: false, isArchived: false }),
      item({ id: "active-fav", isFavorite: true, isArchived: false }),
      item({ id: "archived-a", isFavorite: false, isArchived: true }),
      item({ id: "archived-fav", isFavorite: true, isArchived: true }),
    ];
    const result = filterAndSortProjects(projects, { search: "", sort: "updated", showArchived: true });
    expect(result.map((p) => p.id)).toEqual(["active-fav", "active-a", "archived-fav", "archived-a"]);
  });
});
