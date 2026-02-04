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

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    remind_at DATETIME NOT NULL,
    is_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    topic_name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(created_at);
  CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at);
  CREATE INDEX IF NOT EXISTS idx_topics_user ON topics(user_id);
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

// ========== Reminder Functions ==========

export interface Reminder {
  id: number;
  user_id: number;
  message: string;
  remind_at: string;
  is_sent: number;
}

// Add reminder
export function addReminder(userId: number, message: string, remindAt: Date): number {
  const stmt = db.prepare(`
    INSERT INTO reminders (user_id, message, remind_at) VALUES (?, ?, ?)
  `);
  const result = stmt.run(userId, message, remindAt.toISOString());
  return result.lastInsertRowid as number;
}

// Get pending reminders (due now)
export function getPendingReminders(): Reminder[] {
  const stmt = db.prepare(`
    SELECT * FROM reminders
    WHERE is_sent = 0 AND remind_at <= datetime('now')
    ORDER BY remind_at ASC
  `);
  return stmt.all() as Reminder[];
}

// Mark reminder as sent
export function markReminderSent(reminderId: number) {
  const stmt = db.prepare(`UPDATE reminders SET is_sent = 1 WHERE id = ?`);
  stmt.run(reminderId);
}

// Get user reminders
export function getUserReminders(userId: number): Reminder[] {
  const stmt = db.prepare(`
    SELECT * FROM reminders
    WHERE user_id = ? AND is_sent = 0
    ORDER BY remind_at ASC
  `);
  return stmt.all(userId) as Reminder[];
}

// Delete reminder
export function deleteReminder(reminderId: number) {
  const stmt = db.prepare(`DELETE FROM reminders WHERE id = ?`);
  stmt.run(reminderId);
}

// ========== Topic Functions ==========

// Get or create active topic
export function getActiveTopic(userId: number): string | null {
  const stmt = db.prepare(`
    SELECT topic_name FROM topics
    WHERE user_id = ? AND is_active = 1
    ORDER BY created_at DESC LIMIT 1
  `);
  const row = stmt.get(userId) as { topic_name: string } | undefined;
  return row?.topic_name || null;
}

// Set active topic
export function setActiveTopic(userId: number, topicName: string) {
  // Deactivate all existing topics
  db.prepare(`UPDATE topics SET is_active = 0 WHERE user_id = ?`).run(userId);
  // Create new active topic
  db.prepare(`INSERT INTO topics (user_id, topic_name, is_active) VALUES (?, ?, 1)`).run(userId, topicName);
}

// Clear active topic
export function clearActiveTopic(userId: number) {
  db.prepare(`UPDATE topics SET is_active = 0 WHERE user_id = ?`).run(userId);
}

// ========== Cost Tracking ==========

// Get monthly cost summary
export function getMonthlyCost(userId: number): { month: string; total_tokens: number; total_cost: number }[] {
  const stmt = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) as month,
      SUM(tokens) as total_tokens,
      SUM(cost) as total_cost
    FROM conversations
    WHERE user_id = ? AND role = 'assistant'
    GROUP BY strftime('%Y-%m', created_at)
    ORDER BY month DESC
    LIMIT 6
  `);
  return stmt.all(userId) as { month: string; total_tokens: number; total_cost: number }[];
}

// Get today's cost
export function getTodayCost(userId: number): { tokens: number; cost: number; messages: number } {
  const stmt = db.prepare(`
    SELECT
      COALESCE(SUM(tokens), 0) as tokens,
      COALESCE(SUM(cost), 0) as cost,
      COUNT(*) as messages
    FROM conversations
    WHERE user_id = ? AND date(created_at) = date('now') AND role = 'assistant'
  `);
  return stmt.get(userId) as { tokens: number; cost: number; messages: number };
}

export default db;
