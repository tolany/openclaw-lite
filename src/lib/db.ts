// OpenClaw Lite - SQLite Database

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { ConversationRecord, ChatMessage } from "../types";

const dataDir = path.resolve(__dirname, "../../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "openclaw.db"));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(created_at);
`);

// Save conversation
export function saveConversation(userId: number, role: string, content: string, tokens: number = 0, cost: number = 0) {
  const stmt = db.prepare(`
    INSERT INTO conversations (user_id, role, content, tokens, cost) VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(userId, role, content, tokens, cost);
}

// Get recent history for user
export function getHistory(userId: number, limit: number = 20): ChatMessage[] {
  const stmt = db.prepare(`
    SELECT role, content FROM conversations
    WHERE user_id = ?
    ORDER BY id DESC LIMIT ?
  `);
  const rows = stmt.all(userId, limit) as ChatMessage[];
  return rows.reverse(); // Oldest first
}

// Get usage statistics
export function getUsageStats(userId: number, days: number = 30) {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total_messages,
      SUM(tokens) as total_tokens,
      SUM(cost) as total_cost,
      date(created_at) as date
    FROM conversations
    WHERE user_id = ? AND created_at > datetime('now', ?)
    GROUP BY date(created_at)
    ORDER BY date DESC
  `);
  return stmt.all(userId, `-${days} days`);
}

// Clear history for user
export function clearHistory(userId: number) {
  const stmt = db.prepare(`DELETE FROM conversations WHERE user_id = ?`);
  stmt.run(userId);
}

export default db;
