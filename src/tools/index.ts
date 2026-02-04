// OpenClaw Lite - Tool Registry

import { LibrarianTools } from "./librarian";
import { JournalistTools } from "./journalist";
import { WebTools } from "./web";
import { UtilityTools } from "./utility";
import { Tool, SchemaType } from "@google/generative-ai";

export { LibrarianTools, JournalistTools, WebTools, UtilityTools };

// Tool declarations for Gemini
export function getToolDeclarations(): Tool[] {
  return [{
    functionDeclarations: [
      // Librarian tools
      {
        name: "read_file",
        description: "Read file content. Supports: vault path, gdrive:path, 투자검토:path, or absolute path",
        parameters: {
          type: SchemaType.OBJECT,
          properties: { filePath: { type: SchemaType.STRING, description: "Path with optional prefix: gdrive:, drive:, 투자검토:, work:, personal:" } },
          required: ["filePath"]
        }
      },
      {
        name: "search_files",
        description: "Find files by pattern. Prefix with gdrive:, 투자검토: etc for Drive search",
        parameters: {
          type: SchemaType.OBJECT,
          properties: { pattern: { type: SchemaType.STRING, description: "Glob pattern, optionally prefixed with gdrive:, 투자검토:" } },
          required: ["pattern"]
        }
      },
      {
        name: "search_content",
        description: "Search inside file contents. Use when looking for specific text/data",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Text to search" },
            fileType: { type: SchemaType.STRING, description: "File extension (default: md)" },
            searchIn: { type: SchemaType.STRING, description: "Optional: gdrive:, 투자검토:, or path to search in" }
          },
          required: ["query"]
        }
      },
      {
        name: "list_dir",
        description: "List directory contents. Supports gdrive:, 투자검토: prefixes",
        parameters: {
          type: SchemaType.OBJECT,
          properties: { dirPath: { type: SchemaType.STRING, description: "Directory path with optional prefix" } },
          required: ["dirPath"]
        }
      },
      {
        name: "copy_to_vault",
        description: "Copy file from Drive to vault",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            sourcePath: { type: SchemaType.STRING, description: "Source path (e.g., gdrive:path)" },
            destPath: { type: SchemaType.STRING, description: "Destination path in vault" }
          },
          required: ["sourcePath", "destPath"]
        }
      },
      // Journalist tools
      {
        name: "journal_memory",
        description: "Save important info to daily journal (memory/YYYY-MM-DD.md)",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            content: { type: SchemaType.STRING, description: "Content to save" },
            category: { type: SchemaType.STRING, description: "insight|meeting|todo|idea" }
          },
          required: ["content", "category"]
        }
      },
      {
        name: "write_file",
        description: "Write or append to a file in vault",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            filePath: { type: SchemaType.STRING, description: "Path relative to vault" },
            content: { type: SchemaType.STRING, description: "Content to write" },
            mode: { type: SchemaType.STRING, description: "overwrite|append (default: overwrite)" }
          },
          required: ["filePath", "content"]
        }
      },
      // Web tools
      {
        name: "web_search",
        description: "Search the web for real-time information",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Search query" },
            count: { type: SchemaType.NUMBER, description: "Number of results (default: 5)" }
          },
          required: ["query"]
        }
      },
      // Script runner
      {
        name: "run_script",
        description: "Run predefined automation scripts",
        parameters: {
          type: SchemaType.OBJECT,
          properties: { scriptName: { type: SchemaType.STRING, description: "Script name (run_scraper.sh, run_tracker.sh)" } },
          required: ["scriptName"]
        }
      },
      // PDF reader
      {
        name: "read_pdf",
        description: "Read and parse PDF file content",
        parameters: {
          type: SchemaType.OBJECT,
          properties: { filePath: { type: SchemaType.STRING, description: "Path to PDF file" } },
          required: ["filePath"]
        }
      },
      // Reminder
      {
        name: "set_reminder",
        description: "Set a reminder for later. Parse natural language like '내일 오전 10시', '30분 후'",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            message: { type: SchemaType.STRING, description: "Reminder message" },
            time: { type: SchemaType.STRING, description: "Time in ISO format or relative (e.g., '+30m', '+1h', '+1d')" }
          },
          required: ["message", "time"]
        }
      },
      // Obsidian link
      {
        name: "obsidian_link",
        description: "Generate Obsidian deep link for a file",
        parameters: {
          type: SchemaType.OBJECT,
          properties: { filePath: { type: SchemaType.STRING, description: "Path to file in vault" } },
          required: ["filePath"]
        }
      },
      // Semantic search
      {
        name: "semantic_search",
        description: "Semantic/meaning-based search. Use for vague queries like '돈 많이 번 딜', '실패한 투자'. Returns similar documents by meaning, not keywords.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Natural language query" },
            topK: { type: SchemaType.NUMBER, description: "Number of results (default 5)" }
          },
          required: ["query"]
        }
      }
    ]
  }];
}
