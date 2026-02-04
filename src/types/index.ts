// OpenClaw Lite - Type Definitions

export interface ToolResult {
  content?: string;
  error?: string;
  count?: number;
  files?: string[];
  message?: string;
  results?: SearchResult[];
  // Directory/file operations
  type?: string;
  path?: string;
  basePath?: string;
  total?: number;
  entries?: { name: string; type: string }[];
  // Copy operation
  success?: boolean;
  copied?: string;
}

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export interface JournalEntry {
  time: string;
  category: 'insight' | 'meeting' | 'todo' | 'idea';
  content: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationRecord {
  id?: number;
  user_id: number;
  role: string;
  content: string;
  tokens: number;
  cost: number;
  created_at?: string;
}
