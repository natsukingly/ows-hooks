import Database from "better-sqlite3";
import path from "node:path";

let db: Database.Database | null = null;
let currentPath: string | null = null;

function resolveDbPath(): string {
  return process.env["OWS_PP_AUDIT_DB"] ?? path.join(process.cwd(), "audit.db");
}

export function getSharedDb(): Database.Database {
  const desiredPath = resolveDbPath();

  if (db && currentPath === desiredPath) return db;

  if (db && currentPath !== desiredPath) {
    db.close();
    db = null;
  }

  db = new Database(desiredPath);
  currentPath = desiredPath;
  db.pragma("journal_mode = WAL");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    currentPath = null;
  }
}
