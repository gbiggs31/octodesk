import { describe, expect, it } from "vitest";
import type { SessionEvent, SessionEventType, WrapperInfo } from "@octodesk/core";
import { Engine } from "../src/engine.js";
import { Store } from "../src/store.js";

const TTL = { endedTtlMs: 60_000, staleTtlMs: 600_000 };

function makeEngine(store = new Store(":memory:")) {
  return new Engine(store, TTL);
}

function ev(
  sessionId: string,
  event: SessionEventType,
  overrides: Partial<SessionEvent> = {},
): SessionEvent {
  return {
    provider: "claude",
    sessionId,
    workingDirectory: `C:\\dev\\${sessionId}`,
    event,
    timestamp: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

function wrapper(wrapId: string): WrapperInfo {
  return {
    wrapId,
    pid: 4242,
    windowHandle: "998877",
    workingDirectory: "C:\\dev\\a",
    createdAt: "2026-07-26T09:00:00.000Z",
  };
}

function session(engine: Engine, sessionId: string) {
  return engine.snapshot().sessions.find((s) => s.sessionId === sessionId);
}

describe("wrapper registry", () => {
  it("links a session to its wrapper via the inherited wrapId", () => {
    const engine = makeEngine();
    engine.registerWrapper(wrapper("w1"));
    engine.applyEvent(ev("a", "session_started", { wrapId: "w1" }));
    expect(engine.wrapperFor(session(engine, "a")!)?.windowHandle).toBe("998877");
  });

  it("persists wrappers across restarts", () => {
    const store = new Store(":memory:");
    const first = new Engine(store, TTL);
    first.registerWrapper(wrapper("w1"));
    const second = new Engine(store, TTL);
    second.applyEvent(ev("a", "session_started", { wrapId: "w1" }));
    expect(second.wrapperFor(session(second, "a")!)?.pid).toBe(4242);
  });
});

describe("wrapper exit reports", () => {
  it("clean exit marks the session ended and keeps its leg", () => {
    const engine = makeEngine();
    engine.registerWrapper(wrapper("w1"));
    engine.applyEvent(ev("a", "session_started", { wrapId: "w1" }));
    engine.applyEvent(ev("a", "completed"));
    engine.wrapperExit("w1", 0);
    expect(session(engine, "a")).toMatchObject({ state: "ended", leg: 1 });
    expect(engine.wrapperFor(session(engine, "a")!)).toBeUndefined();
  });

  it("non-zero exit while working goes red with an explanation", () => {
    const engine = makeEngine();
    engine.registerWrapper(wrapper("w1"));
    engine.applyEvent(ev("a", "session_started", { wrapId: "w1" }));
    engine.applyEvent(ev("a", "working"));
    engine.wrapperExit("w1", 3);
    expect(session(engine, "a")?.state).toBe("error");
    expect(session(engine, "a")?.note).toContain("code 3");
  });

  it("non-zero exit after completion is not an error", () => {
    const engine = makeEngine();
    engine.registerWrapper(wrapper("w1"));
    engine.applyEvent(ev("a", "session_started", { wrapId: "w1" }));
    engine.applyEvent(ev("a", "completed"));
    engine.wrapperExit("w1", 130); // e.g. Ctrl+C on the way out
    expect(session(engine, "a")?.state).toBe("ended");
  });

  it("exit for an unknown wrapper is harmless", () => {
    const engine = makeEngine();
    engine.wrapperExit("ghost", 1);
    expect(engine.snapshot().sessions).toHaveLength(0);
  });
});

describe("leg reservation (press-to-launch)", () => {
  const T0 = "2026-07-26T10:00:00.000Z";

  it("the next new session claims the reserved leg", () => {
    const engine = makeEngine();
    engine.reserveLeg(5, Date.parse(T0));
    engine.applyEvent(ev("fresh", "session_started"), "2026-07-26T10:00:30.000Z");
    expect(session(engine, "fresh")?.leg).toBe(5);
  });

  it("reservations expire after two minutes", () => {
    const engine = makeEngine();
    engine.reserveLeg(5, Date.parse(T0));
    engine.applyEvent(ev("late", "session_started"), "2026-07-26T10:03:00.000Z");
    expect(session(engine, "late")?.leg).toBe(1);
  });

  it("a reservation on a leg that got occupied falls back to normal allocation", () => {
    const engine = makeEngine();
    engine.reserveLeg(1, Date.parse(T0));
    engine.applyEvent(ev("interloper", "session_started"), "2026-07-26T10:00:10.000Z"); // takes leg 1 via reservation
    engine.reserveLeg(1, Date.parse(T0)); // stale: leg 1 now occupied
    engine.applyEvent(ev("next", "session_started"), "2026-07-26T10:00:20.000Z");
    expect(session(engine, "next")?.leg).toBe(2);
  });

  it("a reservation is consumed by one session only", () => {
    const engine = makeEngine();
    engine.reserveLeg(4, Date.parse(T0));
    engine.applyEvent(ev("first", "session_started"), "2026-07-26T10:00:10.000Z");
    engine.applyEvent(ev("second", "session_started"), "2026-07-26T10:00:20.000Z");
    expect(session(engine, "first")?.leg).toBe(4);
    expect(session(engine, "second")?.leg).toBe(1);
  });
});

describe("resume migration (resumeOf)", () => {
  it("a resume that mints a new session id inherits the old session's leg", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("old", "session_started"));
    engine.applyEvent(ev("filler", "session_started")); // takes leg 2
    engine.applyEvent(ev("old", "session_ended"));
    engine.applyEvent(ev("new", "session_started", { resumeOf: "old" }));

    expect(session(engine, "old")).toBeUndefined(); // replaced
    expect(session(engine, "new")?.leg).toBe(1); // inherited, not leg 3
    expect(session(engine, "filler")?.leg).toBe(2);
  });

  it("resume with the same session id is a plain resume, no migration", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("same", "session_started"));
    engine.applyEvent(ev("same", "session_ended"));
    engine.applyEvent(ev("same", "session_started", { resumeOf: "same" }));
    expect(session(engine, "same")).toMatchObject({ leg: 1, state: "idle" });
    expect(engine.snapshot().sessions).toHaveLength(1);
  });

  it("resumeOf pointing at an unknown session allocates normally", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("new", "session_started", { resumeOf: "vanished" }));
    expect(session(engine, "new")?.leg).toBe(1);
  });

  it("error notes are cleared when the session recovers", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started"));
    engine.markError("claude", "a", "Resume failed: wt not found");
    expect(session(engine, "a")?.note).toContain("wt not found");
    engine.applyEvent(ev("a", "working"));
    expect(session(engine, "a")).toMatchObject({ state: "working", note: null });
  });
});
