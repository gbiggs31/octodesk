#!/usr/bin/env node
/**
 * octo <provider> [agent args...] — session launcher.
 *
 * Wraps a coding agent so octodesk can focus its terminal window later:
 *   1. captures the foreground window handle (the terminal you typed this in)
 *   2. registers {wrapId, pid, window, cwd} with the daemon (fail-silent)
 *   3. spawns the agent with OCTO_WRAP_ID (and OCTO_RESUME_OF when resuming)
 *      in its environment — hook shims inherit these and report them
 *   4. forwards stdio untouched; the agent experience is identical
 *   5. reports the agent's exit so crashed sessions can go red
 */
import { execFile, spawn, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";

const AGENTS: Record<string, string> = {
  claude: "claude",
};

const provider = process.argv[2] ?? "";
const agentArgs = process.argv.slice(3);
const agent: string = AGENTS[provider] ?? "";

if (agent === "") {
  console.error(`usage: octo <${Object.keys(AGENTS).join("|")}> [agent args...]`);
  process.exit(1);
}

const wrapId = randomUUID();
const daemon = `http://127.0.0.1:${process.env.OCTODESK_PORT ?? "4520"}`;

/** `--resume <id>` / `-r <id>` in the agent args marks this launch as a resume. */
function resumeTarget(args: string[]): string | undefined {
  const i = args.findIndex((a) => a === "--resume" || a === "-r");
  return i !== -1 && args[i + 1] && !args[i + 1]!.startsWith("-") ? args[i + 1] : undefined;
}

/** HWND of the current foreground window — the terminal this command runs in. */
function captureWindowHandle(): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  const script =
    "Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();';" +
    "[W.U]::GetForegroundWindow().ToInt64()";
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 4000 },
      (err, stdout) => {
        const handle = stdout?.trim();
        resolve(!err && handle && /^\d+$/.test(handle) && handle !== "0" ? handle : null);
      },
    );
  });
}

async function tellDaemon(path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${daemon}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(500),
    });
  } catch {
    // Daemon not running — the agent must work exactly the same without it.
  }
}

async function main(): Promise<void> {
  const windowHandle = await captureWindowHandle();
  await tellDaemon("/api/wrappers", {
    wrapId,
    pid: process.pid,
    windowHandle,
    workingDirectory: process.cwd(),
  });

  const resumeOf = resumeTarget(agentArgs);
  const options: SpawnOptions = {
    stdio: "inherit",
    shell: true, // resolves claude.cmd / claude.ps1 shims on Windows
    env: {
      ...process.env,
      OCTO_WRAP_ID: wrapId,
      ...(resumeOf ? { OCTO_RESUME_OF: resumeOf } : {}),
    },
  };
  // Build the command line ourselves: shell:true with an args array is deprecated (DEP0190).
  const quote = (a: string) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a);
  const child = spawn([agent, ...agentArgs.map(quote)].join(" "), options);

  // Ctrl+C goes to the agent; the wrapper must outlive it to report the exit.
  process.on("SIGINT", () => {});

  child.on("exit", (code: number | null) => {
    void tellDaemon("/api/wrappers/exit", { wrapId, exitCode: code ?? 0 }).finally(() =>
      process.exit(code ?? 0),
    );
  });

  child.on("error", (err: Error) => {
    console.error(`octo: failed to start ${agent}: ${err.message}`);
    void tellDaemon("/api/wrappers/exit", { wrapId, exitCode: 127 }).finally(() =>
      process.exit(127),
    );
  });
}

void main();
