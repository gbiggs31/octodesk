import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonConfig {
  port: number;
  dbPath: string;
  /** Ended sessions free their leg after this long without events. */
  endedTtlMs: number;
  /** Any session with no events for this long is expired entirely. */
  staleTtlMs: number;
}

export const DEFAULT_PORT = 4520;

export function loadConfig(): DaemonConfig {
  // Keep the DB out of OneDrive-synced folders (sync churn corrupts SQLite files).
  const dataDir = process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share");
  return {
    port: Number(process.env.OCTODESK_PORT ?? DEFAULT_PORT),
    dbPath: process.env.OCTODESK_DB ?? join(dataDir, "octodesk", "octodesk.db"),
    endedTtlMs: Number(process.env.OCTODESK_ENDED_TTL_MIN ?? 240) * 60_000, // 4 h
    staleTtlMs: Number(process.env.OCTODESK_STALE_TTL_MIN ?? 2880) * 60_000, // 48 h
  };
}
