import { describe, expect, it } from "bun:test";
import { EventBus } from "../src/events/bus";

describe("EventBus", () => {
  it("delivers one event per publish to every subscriber of that project", () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.subscribe("p1", (e) => a.push(e));
    bus.subscribe("p1", (e) => b.push(e));
    bus.publish("p1", 7);
    expect(a).toEqual([{ type: "project.changed", projectId: "p1", version: 7 }]);
    expect(b).toHaveLength(1);
  });

  it("never delivers another project's events", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.subscribe("p1", (e) => seen.push(e));
    bus.publish("p2", 1);
    expect(seen).toHaveLength(0);
  });

  it("unsubscribe stops delivery and drops the project's entry", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const off = bus.subscribe("p1", (e) => seen.push(e));
    expect(bus.subscriberCount("p1")).toBe(1);
    off();
    bus.publish("p1", 1);
    expect(seen).toHaveLength(0);
    expect(bus.subscriberCount("p1")).toBe(0);
    expect(bus.subscriberCount()).toBe(0);
  });

  it("is idempotent when unsubscribe is called twice", () => {
    const bus = new EventBus();
    const off = bus.subscribe("p1", () => {});
    off();
    off();
    expect(bus.subscriberCount("p1")).toBe(0);
  });

  it("a throwing listener does not stop the others", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.subscribe("p1", () => {
      throw new Error("listener blew up");
    });
    bus.subscribe("p1", (e) => seen.push(e));
    expect(() => bus.publish("p1", 1)).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});
