/** UUIDv7 so ids sort by creation time (design §5). */
export function newId(): string {
  return Bun.randomUUIDv7();
}
