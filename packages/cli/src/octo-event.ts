#!/usr/bin/env node
/**
 * octo-event <provider> — hook shim.
 *
 * Reads a hook payload from stdin, normalises it and posts it to the local
 * daemon. Hard requirements: never block the coding agent, never fail loudly,
 * always exit 0 quickly — the agent must behave identically with or without
 * octodesk running.
 */
import type { SessionEvent } from "@octodesk/core";
import { mapClaudeHook } from "./adapters/claude.js";

const HARD_EXIT_MS = 2000;
const POST_TIMEOUT_MS = 500;

// Absolute backstop: whatever happens (hung stdin, slow network), exit 0.
const killer = setTimeout(() => process.exit(0), HARD_EXIT_MS);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  // Strip a UTF-8 BOM — Windows shells add one when piping test payloads.
  return Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
}

function normalise(provider: string, raw: string): SessionEvent | null {
  const payload = JSON.parse(raw) as Record<string, unknown>;
  switch (provider) {
    case "claude":
      return mapClaudeHook(payload);
    case "raw":
      // Pass-through for testing: stdin is already a normalised SessionEvent.
      return payload as unknown as SessionEvent;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const provider = process.argv[2] ?? "";
  const event = normalise(provider, await readStdin());
  if (!event) return;
  const port = process.env.OCTODESK_PORT ?? "4520";
  await fetch(`http://127.0.0.1:${port}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
}

main()
  .catch(() => {}) // daemon down, bad JSON, timeout — all fine, stay silent
  .finally(() => {
    clearTimeout(killer);
    process.exit(0);
  });
