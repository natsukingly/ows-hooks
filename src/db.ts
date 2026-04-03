import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env["OWS_PP_AUDIT_DB"] ?? path.join(process.cwd(), "audit.db");

let db: Database.Database | null = null;

export function getSharedDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
