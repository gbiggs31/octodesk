import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import { buildApp } from "../src/app.js";
import { Engine } from "../src/engine.js";
import { FocusService, type FocusDeps } from "../src/focus.js";
import { Store } from "../src/store.js";

const TTL = { endedTtlMs: 60_000, staleTtlMs: 600_000 };

function makeApp(dbPath = ":memory:") {
  const store = new Store(dbPath);
  const engine = new Engine(store, TTL);
  return { app: buildApp(engine), store, engine };
}

const openApps: FastifyInstance[] = [];
afterEach(async () => {
  while (openApps.length) await openApps.pop()!.close();
});

function post(app: FastifyInstance, url: string, payload: object): Promise<InjectResponse> {
  return app.inject({ method: "POST", url, payload }) as unknown as Promise<InjectResponse>;
}

function get(app: FastifyInstance, url: string): Promise<InjectResponse> {
  return app.inject({ method: "GET", url }) as unknown as Promise<InjectResponse>;
}

const event = (sessionId: string, event: string, provider = "claude") => ({
  provider,
  sessionId,
  workingDirectory: "C:\\dev\\proj",
  event,
  timestamp: new Date().toISOString(),
});

describe("POST /api/events", () => {
  it("accepts a valid event and reflects it in /api/sessions", async () => {
    const { app } = makeApp();
    openApps.push(app);
    const res = await post(app, "/api/events", event("s1", "session_started"));
    expect(res.statusCode).toBe(200);

    const snap = (await get(app, "/api/sessions")).json();
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({ sessionId: "s1", leg: 1, state: "idle" });
    expect(snap.serial).toContain("LEG 1 WHITE DIM");
  });

  it("rejects unknown providers, event types and missing fields", async () => {
    const { app } = makeApp();
    openApps.push(app);
    expect((await post(app, "/api/events", event("s1", "working", "cursor"))).statusCode).toBe(400);
    expect((await post(app, "/api/events", event("s1", "exploded"))).statusCode).toBe(400);
    expect((await post(app, "/api/events", { provider: "claude", event: "working" })).statusCode).toBe(400);
  });
});

describe("press, clear, reassign routes", () => {
  it("presses head and legs", async () => {
    const { app } = makeApp();
    openApps.push(app);
    await post(app, "/api/events", event("s1", "permission_requested"));

    const head = await post(app, "/api/press", { target: "head" });
    expect(head.statusCode).toBe(200);
    expect(head.json().session.sessionId).toBe("s1");

    const miss = await post(app, "/api/press", { target: "leg", leg: 5 });
    expect(miss.statusCode).toBe(404);

    expect((await post(app, "/api/press", { target: "elbow" })).statusCode).toBe(400);
  });

  it("clears and reassigns sessions", async () => {
    const { app } = makeApp();
    openApps.push(app);
    await post(app, "/api/events", event("s1", "session_started"));

    const move = await post(app, "/api/sessions/reassign", { provider: "claude", sessionId: "s1", leg: 4 });
    expect(move.json().ok).toBe(true);

    const cleared = await post(app, "/api/sessions/clear", { provider: "claude", sessionId: "s1" });
    expect(cleared.json().ok).toBe(true);
    expect((await get(app, "/api/sessions")).json().sessions).toHaveLength(0);
  });
});

describe("wrapper routes and physical press actions", () => {
  function fakeFocus(psExit: number) {
    const deps: FocusDeps = {
      platform: "win32",
      octoJsPath: "C:\\repo\\octo.js",
      runPowerShell: () => Promise.resolve(psExit),
      launchDetached: () => {},
    };
    return new FocusService(deps);
  }

  it("registers a wrapper, links it to the session, and focuses on press", async () => {
    const store = new Store(":memory:");
    const engine = new Engine(store, TTL);
    const app = buildApp(engine, fakeFocus(0));
    openApps.push(app);

    await post(app, "/api/wrappers", {
      wrapId: "w1",
      pid: 999,
      windowHandle: "12345",
      workingDirectory: "C:\\dev\\proj",
    });
    await post(app, "/api/events", { ...event("s1", "working"), wrapId: "w1" });

    const pressed = await post(app, "/api/press", { target: "leg", leg: 1 });
    expect(pressed.json()).toMatchObject({ ok: true, action: "focused" });
  });

  it("marks the session red when focus/resume fails", async () => {
    const store = new Store(":memory:");
    const engine = new Engine(store, TTL);
    const app = buildApp(engine, fakeFocus(1)); // focus refused
    openApps.push(app);

    await post(app, "/api/wrappers", { wrapId: "w1", pid: 999, windowHandle: "12345" });
    await post(app, "/api/events", { ...event("s1", "working"), wrapId: "w1" });

    const pressed = await post(app, "/api/press", { target: "leg", leg: 1 });
    expect(pressed.json().action).toBe("failed");
    const snap = (await get(app, "/api/sessions")).json();
    expect(snap.sessions[0].state).toBe("error");
    expect(snap.sessions[0].note).toBeTruthy();
  });

  it("wrapper exit route ends the linked session", async () => {
    const { app } = makeApp();
    openApps.push(app);
    await post(app, "/api/wrappers", { wrapId: "w1", pid: 999, windowHandle: null });
    await post(app, "/api/events", { ...event("s1", "completed"), wrapId: "w1" });
    await post(app, "/api/wrappers/exit", { wrapId: "w1", exitCode: 0 });
    const snap = (await get(app, "/api/sessions")).json();
    expect(snap.sessions[0].state).toBe("ended");
  });

  it("rejects malformed wrapper payloads", async () => {
    const { app } = makeApp();
    openApps.push(app);
    expect((await post(app, "/api/wrappers", { pid: 1 })).statusCode).toBe(400);
    expect((await post(app, "/api/wrappers/exit", {})).statusCode).toBe(400);
  });
});

describe("persistence across daemon restarts", () => {
  it("rehydrates sessions, legs and states from SQLite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "octodesk-test-"));
    const dbPath = join(dir, "test.db");
    try {
      const first = makeApp(dbPath);
      openApps.push(first.app);
      await post(first.app, "/api/events", event("s1", "working"));
      await post(first.app, "/api/events", event("s2", "completed"));
      await first.app.close();
      openApps.pop();
      first.store.close();

      const second = makeApp(dbPath);
      openApps.push(second.app);
      const snap = (await get(second.app, "/api/sessions")).json();
      expect(snap.sessions).toHaveLength(2);
      expect(snap.sessions.find((s: { sessionId: string }) => s.sessionId === "s1")).toMatchObject({
        leg: 1,
        state: "working",
      });
      expect(snap.sessions.find((s: { sessionId: string }) => s.sessionId === "s2")).toMatchObject({
        leg: 2,
        state: "completed",
      });
      await second.app.close();
      openApps.pop();
      second.store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SSE stream", () => {
  it("sends a snapshot on connect", async () => {
    const { app, engine } = makeApp();
    openApps.push(app);
    engine.applyEvent({
      provider: "claude",
      sessionId: "s1",
      workingDirectory: "C:\\dev\\proj",
      event: "working",
      timestamp: new Date().toISOString(),
    });

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const res = await fetch(`${address}/api/stream`);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    await reader.cancel();

    expect(text.startsWith("data: ")).toBe(true);
    const snap = JSON.parse(text.slice("data: ".length, text.indexOf("\n\n")));
    expect(snap.sessions[0].sessionId).toBe("s1");
    expect(snap.head).toBe("working");
  });
});
