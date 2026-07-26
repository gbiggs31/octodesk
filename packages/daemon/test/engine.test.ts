import { describe, expect, it } from "vitest";
import type { SessionEvent, SessionEventType } from "@octodesk/core";
import { Engine } from "../src/engine.js";
import { Store } from "../src/store.js";

const TTL = { endedTtlMs: 60_000, staleTtlMs: 600_000 };

function makeEngine() {
  return new Engine(new Store(":memory:"), TTL);
}

function ev(sessionId: string, event: SessionEventType, overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    provider: "claude",
    sessionId,
    workingDirectory: `C:\\dev\\${sessionId}`,
    event,
    timestamp: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

function session(engine: Engine, sessionId: string) {
  return engine.snapshot().sessions.find((s) => s.sessionId === sessionId);
}

describe("leg allocation", () => {
  it("assigns legs 1..8 in order, then queues the 9th session leg-less", () => {
    const engine = makeEngine();
    for (let i = 1; i <= 9; i++) engine.applyEvent(ev(`s${i}`, "session_started"));
    expect(session(engine, "s1")?.leg).toBe(1);
    expect(session(engine, "s8")?.leg).toBe(8);
    expect(session(engine, "s9")?.leg).toBeNull();
  });

  it("promotes the waiting session when a leg is cleared", () => {
    const engine = makeEngine();
    for (let i = 1; i <= 9; i++) engine.applyEvent(ev(`s${i}`, "session_started"));
    engine.clear("claude", "s3");
    expect(session(engine, "s9")?.leg).toBe(3);
  });

  it("keeps the leg through completion and ending, freeing it only on clear", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started"));
    engine.applyEvent(ev("a", "completed"));
    expect(session(engine, "a")?.leg).toBe(1);
    engine.applyEvent(ev("a", "session_ended"));
    expect(session(engine, "a")?.leg).toBe(1); // resumable via leg press
    engine.clear("claude", "a");
    expect(session(engine, "a")).toBeUndefined();
  });

  it("derives projectName from the working directory", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started", { workingDirectory: "C:\\dev\\my-app" }));
    expect(session(engine, "a")?.projectName).toBe("my-app");
  });
});

describe("state through events", () => {
  it("walks the brief's milestone states", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started"));
    expect(session(engine, "a")?.state).toBe("idle");
    engine.applyEvent(ev("a", "working"));
    expect(session(engine, "a")?.state).toBe("working");
    engine.applyEvent(ev("a", "permission_requested"));
    expect(session(engine, "a")?.state).toBe("needs_input");
    engine.applyEvent(ev("a", "working"));
    engine.applyEvent(ev("a", "completed"));
    expect(session(engine, "a")?.state).toBe("completed");
    engine.applyEvent(ev("a", "session_started")); // resume
    expect(session(engine, "a")?.state).toBe("idle");
  });

  it("providers are independent namespaces", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("same-id", "session_started", { provider: "claude" }));
    engine.applyEvent(ev("same-id", "session_started", { provider: "codex" }));
    expect(engine.snapshot().sessions).toHaveLength(2);
  });
});

describe("press behaviour", () => {
  it("leg press selects the assigned session; unassigned legs report failure", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started"));
    const hit = engine.press({ type: "leg", leg: 1 });
    expect(hit.ok).toBe(true);
    expect(hit.session?.sessionId).toBe("a");
    expect(engine.snapshot().selected?.sessionId).toBe("a");
    expect(engine.press({ type: "leg", leg: 7 }).ok).toBe(false);
  });

  it("head press targets highest priority and cycles within the class", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("w", "working"), "2026-07-26T10:00:00.000Z");
    engine.applyEvent(ev("n1", "permission_requested"), "2026-07-26T10:01:00.000Z");
    engine.applyEvent(ev("n2", "input_requested"), "2026-07-26T10:02:00.000Z");

    expect(engine.press({ type: "head" }).session?.sessionId).toBe("n1"); // oldest needs_input
    expect(engine.press({ type: "head" }).session?.sessionId).toBe("n2"); // cycle
    expect(engine.press({ type: "head" }).session?.sessionId).toBe("n1"); // wrap
  });

  it("head press falls through to lower priorities as classes resolve", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("w", "working"), "2026-07-26T10:00:00.000Z");
    engine.applyEvent(ev("n", "permission_requested"), "2026-07-26T10:01:00.000Z");
    engine.applyEvent(ev("n", "completed"), "2026-07-26T10:02:00.000Z");
    // needs_input resolved → completed now outranks working
    expect(engine.press({ type: "head" }).session?.sessionId).toBe("n");
    engine.clear("claude", "n");
    expect(engine.press({ type: "head" }).session?.sessionId).toBe("w");
  });
});

describe("reassignment", () => {
  it("moves a session to a free leg", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started"));
    expect(engine.reassign("claude", "a", 5)).toBe(true);
    expect(session(engine, "a")?.leg).toBe(5);
  });

  it("swaps legs when the target is occupied", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started"));
    engine.applyEvent(ev("b", "session_started"));
    engine.reassign("claude", "a", 2);
    expect(session(engine, "a")?.leg).toBe(2);
    expect(session(engine, "b")?.leg).toBe(1);
  });

  it("rejects invalid legs and unknown sessions", () => {
    const engine = makeEngine();
    engine.applyEvent(ev("a", "session_started"));
    expect(engine.reassign("claude", "a", 0)).toBe(false);
    expect(engine.reassign("claude", "a", 9)).toBe(false);
    expect(engine.reassign("claude", "nope", 2)).toBe(false);
  });
});

describe("expiry", () => {
  it("expires ended sessions after endedTtl and stale sessions after staleTtl", () => {
    const engine = makeEngine();
    const t0 = Date.parse("2026-07-26T10:00:00.000Z");
    engine.applyEvent(ev("dead", "session_ended"), "2026-07-26T10:00:00.000Z");
    engine.applyEvent(ev("quiet", "session_started"), "2026-07-26T10:00:00.000Z");

    engine.expireStale(t0 + TTL.endedTtlMs + 1);
    expect(session(engine, "dead")).toBeUndefined();
    expect(session(engine, "quiet")).toBeDefined();

    engine.expireStale(t0 + TTL.staleTtlMs + 1);
    expect(session(engine, "quiet")).toBeUndefined();
  });

  it("promotes waiting sessions after expiry frees legs", () => {
    const engine = makeEngine();
    const t = "2026-07-26T10:00:00.000Z";
    for (let i = 1; i <= 8; i++) engine.applyEvent(ev(`s${i}`, "session_ended"), t);
    engine.applyEvent(ev("fresh", "session_started"), "2026-07-26T10:00:30.000Z");
    expect(session(engine, "fresh")?.leg).toBeNull();

    engine.expireStale(Date.parse(t) + TTL.endedTtlMs + 1);
    expect(session(engine, "fresh")?.leg).toBe(1);
  });
});
