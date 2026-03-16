import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";
import config from "./config.js";

// Ensure the data directory exists
mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_username TEXT NOT NULL,
    github_id INTEGER NOT NULL,
    message_text TEXT NOT NULL,
    proposed_label TEXT NOT NULL,
    model_label TEXT,
    model_confidence REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_username TEXT,
    reviewer_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at);
`);

export default db;
