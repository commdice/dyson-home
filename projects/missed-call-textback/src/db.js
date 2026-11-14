// Call and message log in SQLite (built into Node 22, no install needed).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY,
      call_sid TEXT UNIQUE,
      from_number TEXT,
      outcome TEXT,          -- answered | missed | after_hours
      dial_status TEXT,
      texted INTEGER DEFAULT 0,
      skip_reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      direction TEXT,        -- out | in
      number TEXT,
      body TEXT,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_number ON messages(number, direction, created_at);
  `);

  const q = {
    upsertCall: db.prepare(`
      INSERT INTO calls (call_sid, from_number, outcome, dial_status, texted, skip_reason)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(call_sid) DO UPDATE SET
        outcome = excluded.outcome, dial_status = excluded.dial_status,
        texted = excluded.texted, skip_reason = excluded.skip_reason`),
    callBySid: db.prepare(`SELECT * FROM calls WHERE call_sid = ?`),
    addMessage: db.prepare(`INSERT INTO messages (direction, number, body, status) VALUES (?, ?, ?, ?)`),
    lastOut: db.prepare(`
      SELECT created_at FROM messages
      WHERE number = ? AND direction = 'out' AND status = 'sent'
      ORDER BY id DESC LIMIT 1`),
    recentCalls: db.prepare(`SELECT * FROM calls ORDER BY id DESC LIMIT ?`),
    recentMessages: db.prepare(`SELECT * FROM messages ORDER BY id DESC LIMIT ?`),
    stats: db.prepare(`
      SELECT
        SUM(outcome = 'answered') AS answered,
        SUM(outcome IN ('missed','after_hours')) AS missed,
        SUM(texted) AS texted,
        (SELECT COUNT(*) FROM messages WHERE direction = 'in') AS replies
      FROM calls WHERE created_at >= datetime('now', '-30 days')`),
  };

  return {
    raw: db,
    logCall({ callSid, from, outcome, dialStatus = null, texted = false, skipReason = null }) {
      q.upsertCall.run(callSid, from, outcome, dialStatus, texted ? 1 : 0, skipReason);
    },
    getCall: (sid) => q.callBySid.get(sid),
    logMessage: (direction, number, body, status) => q.addMessage.run(direction, number, body, status),
    lastTextedAt(number) {
      const row = q.lastOut.get(number);
      return row ? new Date(row.created_at.replace(' ', 'T') + 'Z') : null;
    },
    recentCalls: (n = 50) => q.recentCalls.all(n),
    recentMessages: (n = 50) => q.recentMessages.all(n),
    stats: () => q.stats.get(),
  };
}
