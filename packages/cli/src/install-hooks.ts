#!/usr/bin/env node
/**
 * install-hooks — register octo-event with Claude Code.
 *
 * Dry-run by default: prints what would change. Pass --write to apply
 * (the existing settings file is backed up first). Idempotent: existing
 * octo-event entries are replaced, everything else is left untouched.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

type Settings = { hooks?: Record<string, HookMatcher[]> } & Record<string, unknown>;

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "octo-event.js");
const command = `node "${scriptPath}" claude`;
const settingsPath = join(homedir(), ".claude", "settings.json");
const write = process.argv.includes("--write");

if (!existsSync(scriptPath)) {
  console.error(`octo-event.js not found at ${scriptPath} — run "npm run build:cli" first.`);
  process.exit(1);
}

const settings: Settings = existsSync(settingsPath)
  ? (JSON.parse(readFileSync(settingsPath, "utf8")) as Settings)
  : {};
settings.hooks ??= {};

for (const event of HOOK_EVENTS) {
  const entries = (settings.hooks[event] ?? []).filter(
    // Drop any previous octodesk registration (idempotent re-install).
    (entry) => !entry.hooks?.some((h) => h.command?.includes("octo-event")),
  );
  entries.push({ hooks: [{ type: "command", command, timeout: 10 }] });
  settings.hooks[event] = entries;
}

const serialised = JSON.stringify(settings, null, 2) + "\n";

if (!write) {
  console.log(`Would update ${settingsPath} with octodesk hooks for:`);
  console.log(`  ${HOOK_EVENTS.join(", ")}`);
  console.log(`Each running: ${command}\n`);
  console.log("Resulting settings.json:\n");
  console.log(serialised);
  console.log("Re-run with --write to apply.");
} else {
  if (existsSync(settingsPath)) {
    const backup = `${settingsPath}.octodesk-backup-${Date.now()}`;
    copyFileSync(settingsPath, backup);
    console.log(`Backed up existing settings to ${backup}`);
  }
  writeFileSync(settingsPath, serialised, "utf8");
  console.log(`Wrote octodesk hooks to ${settingsPath}`);
  console.log("Note: already-running Claude Code sessions pick up hook changes only after restart.");
}
