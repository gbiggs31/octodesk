import { describe, expect, it } from "vitest";
import {
  allocateLeg,
  firstFreeLeg,
  nextWaitingSession,
  type SessionRecord,
} from "../src/index.js";

function record(overrides: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
  return {
    leg: null,
    provider: "claude",
    workingDirectory: "C:\\dev\\proj",
    projectName: "proj",
    state: "idle",
    createdAt: "2026-07-26T10:00:00.000Z",
    lastEventAt: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("firstFreeLeg", () => {
  it("returns 1 for an empty octopus", () => {
    expect(firstFreeLeg([])).toBe(1);
  });

  it("fills gaps lowest-first", () => {
    const records = [record({ sessionId: "a", leg: 1 }), record({ sessionId: "c", leg: 3 })];
    expect(firstFreeLeg(records)).toBe(2);
  });

  it("returns null when all 8 legs are taken", () => {
    const records = Array.from({ length: 8 }, (_, i) =>
      record({ sessionId: `s${i}`, leg: i + 1 }),
    );
    expect(firstFreeLeg(records)).toBeNull();
  });
});

describe("allocateLeg", () => {
  it("reclaims the previous leg when free", () => {
    const records = [record({ sessionId: "a", leg: 1 })];
    expect(allocateLeg(records, 5)).toBe(5);
  });

  it("falls back to first free leg when the previous leg is occupied", () => {
    const records = [record({ sessionId: "a", leg: 1 }), record({ sessionId: "b", leg: 5 })];
    expect(allocateLeg(records, 5)).toBe(2);
  });

  it("ignores out-of-range previous legs", () => {
    expect(allocateLeg([], 12)).toBe(1);
    expect(allocateLeg([], 0)).toBe(1);
  });

  it("returns null when the octopus is full", () => {
    const records = Array.from({ length: 8 }, (_, i) =>
      record({ sessionId: `s${i}`, leg: i + 1 }),
    );
    expect(allocateLeg(records, 3)).toBeNull();
  });
});

describe("nextWaitingSession", () => {
  it("promotes the longest-waiting leg-less live session", () => {
    const records = [
      record({ sessionId: "with-leg", leg: 1 }),
      record({ sessionId: "late", leg: null, createdAt: "2026-07-26T11:00:00.000Z" }),
      record({ sessionId: "early", leg: null, createdAt: "2026-07-26T09:00:00.000Z" }),
    ];
    expect(nextWaitingSession(records)?.sessionId).toBe("early");
  });

  it("never promotes ended sessions", () => {
    const records = [
      record({ sessionId: "dead", leg: null, state: "ended", createdAt: "2026-07-26T08:00:00.000Z" }),
      record({ sessionId: "alive", leg: null, createdAt: "2026-07-26T09:00:00.000Z" }),
    ];
    expect(nextWaitingSession(records)?.sessionId).toBe("alive");
  });

  it("returns null when nobody is waiting", () => {
    expect(nextWaitingSession([record({ sessionId: "a", leg: 1 })])).toBeNull();
  });
});
