import { describe, expect, it } from "vitest";
import type { SessionRecord, WrapperInfo } from "@octodesk/core";
import { FocusService, type FocusDeps } from "../src/focus.js";

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    leg: 1,
    provider: "claude",
    sessionId: "sess-1",
    workingDirectory: "C:\\dev\\proj",
    projectName: "proj",
    state: "working",
    createdAt: "2026-07-26T09:00:00.000Z",
    lastEventAt: "2026-07-26T10:00:00.000Z",
    wrapId: "wrap-1",
    ...overrides,
  };
}

function wrapper(overrides: Partial<WrapperInfo> = {}): WrapperInfo {
  return {
    wrapId: "wrap-1",
    pid: 1234,
    windowHandle: "660412",
    workingDirectory: "C:\\dev\\proj",
    createdAt: "2026-07-26T09:00:00.000Z",
    ...overrides,
  };
}

interface Recorded {
  scripts: string[];
  launches: Array<{ command: string; args: string[]; cwd: string }>;
}

function makeService(opts: { psExit?: number; launchThrows?: boolean; platform?: NodeJS.Platform } = {}) {
  const recorded: Recorded = { scripts: [], launches: [] };
  const deps: FocusDeps = {
    platform: opts.platform ?? "win32",
    octoJsPath: "C:\\repo\\packages\\cli\\dist\\octo.js",
    newSessionDir: "C:\\projects",
    runPowerShell: (script) => {
      recorded.scripts.push(script);
      return Promise.resolve(opts.psExit ?? 0);
    },
    launchDetached: (command, args, cwd) => {
      if (opts.launchThrows) throw new Error("wt not found");
      recorded.launches.push({ command, args, cwd });
    },
  };
  return { service: new FocusService(deps), recorded };
}

describe("FocusService.act", () => {
  it("focuses when the wrapper's window still exists", async () => {
    const { service, recorded } = makeService({ psExit: 0 });
    const result = await service.act(session(), wrapper());
    expect(result.action).toBe("focused");
    expect(recorded.scripts[0]).toContain("660412");
    expect(recorded.launches).toHaveLength(0);
  });

  it("resumes in a new terminal when the window is gone (exit 2)", async () => {
    const { service, recorded } = makeService({ psExit: 2 });
    const result = await service.act(session(), wrapper());
    expect(result.action).toBe("resumed");
    const launch = recorded.launches[0]!;
    expect(launch.command).toBe("wt");
    expect(launch.args).toEqual([
      "-d",
      "C:\\dev\\proj",
      "node",
      "C:\\repo\\packages\\cli\\dist\\octo.js",
      "claude",
      "--resume",
      "sess-1",
    ]);
  });

  it("reports failure (not resume!) when focusing is refused — the session may be alive", async () => {
    const { service, recorded } = makeService({ psExit: 1 });
    const result = await service.act(session(), wrapper());
    expect(result.action).toBe("failed");
    expect(recorded.launches).toHaveLength(0);
  });

  it("never resumes a live session that has no window association", async () => {
    const { service, recorded } = makeService();
    const result = await service.act(session({ state: "working", wrapId: null }), undefined);
    expect(result.action).toBe("no_window");
    expect(recorded.launches).toHaveLength(0);
  });

  it("resumes ended sessions that have no wrapper", async () => {
    const { service, recorded } = makeService();
    const result = await service.act(session({ state: "ended", wrapId: null }), undefined);
    expect(result.action).toBe("resumed");
    expect(recorded.launches).toHaveLength(1);
  });

  it("resumes errored sessions that have no wrapper", async () => {
    const { service } = makeService();
    const result = await service.act(session({ state: "error", wrapId: null }), undefined);
    expect(result.action).toBe("resumed");
  });

  it("reports failed when the terminal launch throws", async () => {
    const { service } = makeService({ launchThrows: true });
    const result = await service.act(session({ state: "ended", wrapId: null }), undefined);
    expect(result.action).toBe("failed");
    expect(result.detail).toContain("wt not found");
  });

  it("is disabled on non-Windows platforms", async () => {
    const { service, recorded } = makeService({ platform: "linux" });
    const result = await service.act(session(), wrapper());
    expect(result.action).toBe("disabled");
    expect(recorded.scripts).toHaveLength(0);
    expect(recorded.launches).toHaveLength(0);
  });

  it("launchNew starts a wrapped claude session in the configured directory", () => {
    const { service, recorded } = makeService();
    const result = service.launchNew();
    expect(result.action).toBe("launched");
    expect(recorded.launches[0]).toEqual({
      command: "wt",
      args: ["-d", "C:\\projects", "node", "C:\\repo\\packages\\cli\\dist\\octo.js", "claude"],
      cwd: "C:\\projects",
    });
  });

  it("launchNew reports failure when the terminal cannot start", () => {
    const { service } = makeService({ launchThrows: true });
    expect(service.launchNew().action).toBe("failed");
  });

  it("launchNew is disabled off-Windows", () => {
    const { service, recorded } = makeService({ platform: "darwin" });
    expect(service.launchNew().action).toBe("disabled");
    expect(recorded.launches).toHaveLength(0);
  });

  it("does not resume providers without resume support", async () => {
    const { service } = makeService();
    const result = await service.act(
      session({ provider: "codex", state: "ended", wrapId: null }),
      undefined,
    );
    expect(result.action).toBe("no_window");
  });
});
