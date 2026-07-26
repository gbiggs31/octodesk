import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionRecord } from "@octodesk/core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  provider         TEXT NOT NULL,
  sessionId        TEXT NOT NULL,
  leg              INTEGER,
  workingDirectory TEXT NOT NULL,
  projectName      TEXT NOT NULL,
  state            TEXT NOT NULL,
  createdAt        TEXT NOT NULL,
  lastEventAt      TEXT NOT NULL,
  wrapId           TEXT,
  note             TEXT,
  PRIMARY KEY (provider, sessionId)
);
`;

/** Synchronous SQLite persistence via node:sqlite (no native deps). */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  loadAll(): SessionRecord[] {
    const rows = this.db.prepare("SELECT * FROM sessions").all() as Array<
      Omit<SessionRecord, "leg"> & { leg: number | bigint | null }
    >;
    return rows.map((row) => ({ ...row, leg: row.leg === null ? null : Number(row.leg) }));
  }

  upsert(r: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions
           (provider, sessionId, leg, workingDirectory, projectName, state, createdAt, lastEventAt, wrapId, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, sessionId) DO UPDATE SET
           leg = excluded.leg,
           workingDirectory = excluded.workingDirectory,
           projectName = excluded.projectName,
           state = excluded.state,
           lastEventAt = excluded.lastEventAt,
           wrapId = excluded.wrapId,
           note = excluded.note`,
      )
      .run(
        r.provider,
        r.sessionId,
        r.leg,
        r.workingDirectory,
        r.projectName,
        r.state,
        r.createdAt,
        r.lastEventAt,
        r.wrapId ?? null,
        r.note ?? null,
      );
  }

  remove(provider: string, sessionId: string): void {
    this.db
      .prepare("DELETE FROM sessions WHERE provider = ? AND sessionId = ?")
      .run(provider, sessionId);
  }

  close(): void {
    this.db.close();
  }
}
