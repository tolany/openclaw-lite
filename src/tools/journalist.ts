// OpenClaw Lite - The Journalist Tools
// journal_memory, write_file

import * as fs from "fs";
import * as path from "path";
import { ToolResult } from "../types";

export class JournalistTools {
  private vaultPath: string;
  private blockedExtensions = [".sh", ".js", ".ts", ".py", ".exe", ".bat", ".cmd", ".ps1"];

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  // Save to daily journal
  journalMemory(content: string, category: 'insight' | 'meeting' | 'todo' | 'idea'): ToolResult {
    try {
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const time = new Date().toTimeString().split(" ")[0].substring(0, 5); // HH:MM

      const memoryDir = path.join(this.vaultPath, ".openclaw", "memory");
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
      }

      const filePath = path.join(memoryDir, `${today}.md`);
      const categoryEmoji = {
        insight: "💡",
        meeting: "🤝",
        todo: "✅",
        idea: "🎯"
      };

      const entry = `\n## ${categoryEmoji[category]} ${category.toUpperCase()} [${time}]\n${content}\n`;

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `# Daily Journal - ${today}\n${entry}`);
      } else {
        fs.appendFileSync(filePath, entry);
      }

      return { message: `Saved to memory/${today}.md` };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // Write file with security checks
  writeFile(filePath: string, content: string, mode: 'overwrite' | 'append' = 'overwrite'): ToolResult {
    try {
      const fullPath = path.join(this.vaultPath, filePath);

      // Security: vault path restriction
      if (!fullPath.startsWith(this.vaultPath)) {
        return { error: "Access denied: outside vault" };
      }

      // Security: block executable extensions
      const ext = path.extname(filePath).toLowerCase();
      if (this.blockedExtensions.includes(ext)) {
        return { error: `Blocked extension: ${ext}` };
      }

      // Ensure directory exists
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (mode === "append") {
        fs.appendFileSync(fullPath, content);
      } else {
        fs.writeFileSync(fullPath, content);
      }

      return { message: `File ${mode === 'append' ? 'appended' : 'written'}: ${filePath}` };
    } catch (err: any) {
      return { error: err.message };
    }
  }
}
