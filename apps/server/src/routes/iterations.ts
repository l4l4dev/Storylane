import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { EventBus } from "../events/bus";
import type { Logger } from "../log";
import { HttpError } from "../http-error";
import { deleteIterationOverride, listIterationOverrides, putIterationOverride } from "../services/iterations";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

const OVERRIDE_KEYS = new Set(["length", "team_strength"]);

function rejectUnknownKeys(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    if (!OVERRIDE_KEYS.has(key)) throw new HttpError(400, "invalid_body", `unknown field ${key}`);
  }
}

/** Strict on purpose: "3abc", "1.5", "1e2" and "" must all be refused, not coerced by Number(). */
const NUMBER_RE = /^[1-9]\d*$/;

function parseNumber(raw: string): number {
  if (!NUMBER_RE.test(raw) || !Number.isSafeInteger(Number(raw))) throw new HttpError(400, "iteration_number_invalid");
  return Number(raw);
}

export function iterationRoutes(deps: { db: Db; bus: EventBus; log: Logger; actorOf: (c: Context) => Actor }) {
  const { db, actorOf } = deps;
  return new Hono()
    .get("/api/projects/:id/iteration_overrides", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "iteration:read", (tx) => listIterationOverrides(tx))),
    )
    .put("/api/projects/:id/iteration_overrides/:number", async (c) => {
      const input = await body(c);
      return c.json(
        withProjectChange(deps, actorOf(c), c.req.param("id"), "iteration:override", (tx) => {
          const number = parseNumber(c.req.param("number"));
          rejectUnknownKeys(input);
          const patch: { length?: number | null; team_strength?: number } = {};
          if (input.length !== undefined) patch.length = input.length as number | null;
          if (input.team_strength !== undefined) patch.team_strength = input.team_strength as number;
          return putIterationOverride(tx, number, patch);
        }),
      );
    })
    .delete("/api/projects/:id/iteration_overrides/:number", (c) => {
      withProjectChange(deps, actorOf(c), c.req.param("id"), "iteration:override", (tx) => {
        const number = parseNumber(c.req.param("number"));
        deleteIterationOverride(tx, number);
      });
      return c.body(null, 204);
    });
}
