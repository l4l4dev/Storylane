/**
 * Per-route data the matrix needs to make a *valid* request, so a 4xx it asserts comes from
 * authorization and not from a missing path param or body. Keys match ROUTE_ACTIONS exactly.
 */
export interface MatrixFixture {
  /** Values for path params other than :id (which is always the seeded project). */
  params?: Record<string, string>;
  /** JSON body for non-GET routes. */
  body?: unknown;
  /** Server-sent-events route: cancel the body once the status is known. */
  stream?: boolean;
}

/**
 * Ids the fixtures need are seeded per test run, so this is a function of them rather than a
 * constant. Each later task adds the field its routes need (stateId, storyId, inviteId, userId).
 */
export interface MatrixContext {
  projectId: string;
}

// ctx is unused until the first parameterized route lands; the signature is already what later tasks import.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function matrixFixtures(_ctx: MatrixContext): Record<string, MatrixFixture> {
  return {};
}
