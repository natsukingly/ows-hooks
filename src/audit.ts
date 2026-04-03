import Database from "better-sqlite3";
import path from "node:path";
import type { AuditEntry } from "./types.js";

const DB_PATH = path.join(
  process.env["OWS_PP_AUDIT_DB"] ?? path.join(process.cwd(), "audit.db"),
);

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      wallet_id     TEXT NOT NULL,
      chain_id      TEXT NOT NULL,
      tx_to         TEXT NOT NULL,
      tx_value      TEXT NOT NULL,
      policy_name   TEXT NOT NULL,
      result        TEXT NOT NULL CHECK(result IN ('allow', 'deny')),
      reason        TEXT,
      context_hash  TEXT NOT NULL
    );
  `);

  // Append-only constraint: prohibit DELETE/UPDATE
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS no_delete_audit
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only: DELETE is prohibited');
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS no_update_audit
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE is prohibited');
    END;
  `);

  return db;
}

const insertStmt = () =>
  getDb().prepare(`
  INSERT INTO audit_log (timestamp, agent_id, wallet_id, chain_id, tx_to, tx_value, policy_name, result, reason, context_hash)
  VALUES (@timestamp, @agent_id, @wallet_id, @chain_id, @tx_to, @tx_value, @policy_name, @result, @reason, @context_hash)
`);

let cachedInsert: Database.Statement | null = null;

export function recordAudit(entry: AuditEntry): void {
  if (!cachedInsert) {
    cachedInsert = insertStmt();
  }
  cachedInsert.run(entry);
}

/** Retrieve all audit log entries (for demo/debug purposes) */
export function getAuditLog(): AuditEntry[] {
  return getDb().prepare("SELECT * FROM audit_log ORDER BY id").all() as AuditEntry[];
}

/** Close the DB connection */
export function closeAudit(): void {
  if (db) {
    db.close();
    db = null;
    cachedInsert = null;
  }
}
