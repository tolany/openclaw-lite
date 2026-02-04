// OpenClaw Lite - The Librarian Tools
// read_file, search_files, search_content

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { glob } from "glob";
import { ToolResult, SearchResult } from "../types";

export class LibrarianTools {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  // Read file content
  readFile(filePath: string): ToolResult {
    try {
      const fullPath = path.join(this.vaultPath, filePath);
      if (!fullPath.startsWith(this.vaultPath)) {
        return { error: "Access denied: outside vault" };
      }
      if (fs.existsSync(fullPath)) {
        return { content: fs.readFileSync(fullPath, "utf-8") };
      }
      return { error: "File not found" };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // Search files by pattern (filename only)
  async searchFiles(pattern: string): Promise<ToolResult> {
    try {
      const files = await glob(pattern, { cwd: this.vaultPath, nodir: true });
      return { count: files.length, files: files.slice(0, 10) };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // Search file contents using grep (ripgrep fallback)
  searchContent(query: string, fileType?: string): ToolResult {
    try {
      const typeFilter = fileType ? `--include="*.${fileType}"` : '--include="*.md"';
      const cmd = `grep -rn ${typeFilter} -m 15 "${query}" "${this.vaultPath}" 2>/dev/null | head -15`;

      const output = execSync(cmd, { encoding: "utf-8", maxBuffer: 1024 * 1024 });

      if (!output.trim()) {
        return { count: 0, results: [], message: "No matches found" };
      }

      const results: SearchResult[] = output.trim().split("\n").map(line => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          return {
            file: match[1].replace(this.vaultPath + "/", ""),
            line: parseInt(match[2]),
            text: match[3].substring(0, 100)
          };
        }
        return { file: "", line: 0, text: line };
      }).filter(r => r.file);

      return { count: results.length, results };
    } catch (err: any) {
      if (err.status === 1) {
        return { count: 0, results: [], message: "No matches found" };
      }
      return { error: err.message };
    }
  }
}
