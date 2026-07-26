import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SessionRecord, WrapperInfo } from "@octodesk/core";

export type PressActionKind = "focused" | "resumed" | "no_window" | "disabled" | "failed";

export interface FocusResult {
  action: PressActionKind;
  detail?: string;
}

/** Injectable so tests can fake the OS layer. */
export interface FocusDeps {
  platform: NodeJS.Platform;
  /** Absolute path to the built octo.js wrapper, used for resume launches. */
  octoJsPath: string;
  /** Runs a PowerShell script, resolves with its exit code. */
  runPowerShell(script: string): Promise<number>;
  /** Fire-and-forget detached launch; throws synchronously if spawn fails. */
  launchDetached(command: string, args: string[], cwd: string): void;
}

export function defaultFocusDeps(): FocusDeps {
  return {
    platform: process.platform,
    octoJsPath: fileURLToPath(new URL("../../cli/dist/octo.js", import.meta.url)),
    runPowerShell(script) {
      return new Promise((resolve) => {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", script],
          { timeout: 5000 },
          (err) => resolve(err ? ((err as { code?: number }).code ?? 1) : 0),
        );
      });
    },
    launchDetached(command, args, cwd) {
      const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
      child.on("error", () => {}); // async spawn errors surface as a session that never appears
      child.unref();
    },
  };
}

/** Exit codes of the focus script: 0 focused, 2 window gone, anything else refused. */
function focusScript(windowHandle: string): string {
  return (
    "Add-Type -Namespace W -Name U -MemberDefinition '" +
    '[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);' +
    '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);' +
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);' +
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' +
    '[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool a);' +
    "';" +
    `$h = [IntPtr]${windowHandle};` +
    "if (-not [W.U]::IsWindow($h)) { exit 2 };" +
    "if ([W.U]::IsIconic($h)) { [W.U]::ShowWindow($h, 9) | Out-Null };" +
    "[W.U]::SetForegroundWindow($h) | Out-Null;" +
    "[W.U]::SwitchToThisWindow($h, $true);" +
    "exit 0"
  );
}

/**
 * Executes the physical half of a press: focus the session's terminal window
 * if it still exists, otherwise resume the session in a fresh terminal.
 * Never resumes a session that might still be alive (that would duplicate it).
 */
export class FocusService {
  constructor(private deps: FocusDeps = defaultFocusDeps()) {}

  async act(session: SessionRecord, wrapper: WrapperInfo | undefined): Promise<FocusResult> {
    if (process.env.OCTODESK_FOCUS === "0") return { action: "disabled" };
    if (this.deps.platform !== "win32") {
      return { action: "disabled", detail: "window focusing is Windows-only in this version" };
    }

    if (wrapper?.windowHandle && !/^\d+$/.test(wrapper.windowHandle)) {
      return { action: "failed", detail: "corrupt window handle" };
    }

    if (wrapper?.windowHandle) {
      const code = await this.deps.runPowerShell(focusScript(wrapper.windowHandle));
      if (code === 0) return { action: "focused" };
      if (code !== 2) return { action: "failed", detail: "could not bring the window forward" };
      // code 2: the window is gone — the terminal was closed. Fall through to resume.
    } else if (wrapper) {
      // Wrapper alive but we never captured a window: focusing is impossible,
      // and resuming would duplicate the live session.
      return { action: "no_window", detail: "no window was captured for this session" };
    } else if (session.state !== "ended" && session.state !== "error") {
      // No wrapper at all: probably launched without `octo`. Only dead sessions resume.
      return {
        action: "no_window",
        detail: "session has no associated window — launch with `octo claude` to enable focusing",
      };
    }

    if (session.provider !== "claude") {
      return { action: "no_window", detail: `resume is not implemented for ${session.provider}` };
    }
    try {
      this.deps.launchDetached(
        "wt",
        ["-d", session.workingDirectory, "node", this.deps.octoJsPath, "claude", "--resume", session.sessionId],
        session.workingDirectory,
      );
      return { action: "resumed" };
    } catch (err) {
      return { action: "failed", detail: `could not launch terminal: ${(err as Error).message}` };
    }
  }
}
