// OpenClaw Lite - The Librarian Tools
// read_file, search_files, search_content

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { glob } from "glob";
import { ToolResult, SearchResult } from "../types";

// Path aliases for Google Drive
const PATH_ALIASES: Record<string, string> = {
  "gdrive:": "/mnt/g/내 드라이브/",
  "drive:": "/mnt/g/내 드라이브/",
  "드라이브:": "/mnt/g/내 드라이브/",
  "work:": "/mnt/g/내 드라이브/01_Work/",
  "personal:": "/mnt/g/내 드라이브/02_Personal/",
  "투자검토:": "/mnt/g/내 드라이브/01_Work/HIP 업무/PE본부 Work/투자검토기업 자료/",
};

// Allowed base paths (vault + Google Drive)
const ALLOWED_PATHS = [
  "/home/jblee/obsidian-vault",
  "/mnt/g/내 드라이브",
  "/mnt/c/Users/jblee",
];

export class LibrarianTools {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  // Resolve path aliases and check access
  private resolvePath(filePath: string): { fullPath: string; error?: string } {
    let resolvedPath = filePath;

    // Check for aliases
    for (const [alias, basePath] of Object.entries(PATH_ALIASES)) {
      if (filePath.startsWith(alias)) {
        resolvedPath = path.join(basePath, filePath.substring(alias.length));
        break;
      }
    }

    // If still relative, treat as vault-relative
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.join(this.vaultPath, resolvedPath);
    }

    // Security check - must be in allowed paths
    const isAllowed = ALLOWED_PATHS.some(allowed => resolvedPath.startsWith(allowed));
    if (!isAllowed) {
      return { fullPath: "", error: `Access denied: ${resolvedPath}` };
    }

    return { fullPath: resolvedPath };
  }

  // Read file content
  readFile(filePath: string): ToolResult {
    try {
      const { fullPath, error } = this.resolvePath(filePath);
      if (error) return { error };

      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          // List directory contents
          const files = fs.readdirSync(fullPath);
          return {
            type: "directory",
            path: fullPath,
            files: files.slice(0, 30),
            total: files.length
          };
        }
        return { content: fs.readFileSync(fullPath, "utf-8") };
      }
      return { error: "File not found" };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // Search files by pattern (filename only)
  // Supports: pattern, gdrive:pattern, 투자검토:pattern
  async searchFiles(pattern: string): Promise<ToolResult> {
    try {
      let searchPath = this.vaultPath;
      let searchPattern = pattern;

      // Check for path aliases
      for (const [alias, basePath] of Object.entries(PATH_ALIASES)) {
        if (pattern.startsWith(alias)) {
          searchPath = basePath;
          searchPattern = pattern.substring(alias.length) || "**/*";
          break;
        }
      }

      const files = await glob(searchPattern, { cwd: searchPath, nodir: true });
      return {
        count: files.length,
        basePath: searchPath,
        files: files.slice(0, 15)
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // Search file contents using grep
  // Supports: query, gdrive:query, 투자검토:query
  searchContent(query: string, fileType?: string, searchIn?: string): ToolResult {
    try {
      let searchPath = this.vaultPath;

      // Check for path prefix in searchIn parameter
      if (searchIn) {
        const { fullPath, error } = this.resolvePath(searchIn);
        if (error) return { error };
        searchPath = fullPath;
      }

      const typeFilter = fileType ? `--include="*.${fileType}"` : '--include="*.md" --include="*.txt" --include="*.pdf"';
      const cmd = `grep -rn ${typeFilter} -m 15 "${query}" "${searchPath}" 2>/dev/null | head -15`;

      const output = execSync(cmd, { encoding: "utf-8", maxBuffer: 1024 * 1024 });

      if (!output.trim()) {
        return { count: 0, results: [], message: "No matches found" };
      }

      const results: SearchResult[] = output.trim().split("\n").map(line => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          return {
            file: match[1].replace(searchPath + "/", ""),
            line: parseInt(match[2]),
            text: match[3].substring(0, 100)
          };
        }
        return { file: "", line: 0, text: line };
      }).filter(r => r.file);

      return { count: results.length, basePath: searchPath, results };
    } catch (err: any) {
      if (err.status === 1) {
        return { count: 0, results: [], message: "No matches found" };
      }
      return { error: err.message };
    }
  }

  // List directory contents
  listDir(dirPath: string): ToolResult {
    try {
      const { fullPath, error } = this.resolvePath(dirPath);
      if (error) return { error };

      if (!fs.existsSync(fullPath)) {
        return { error: "Directory not found" };
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        return { error: "Not a directory" };
      }

      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const files = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file"
      }));

      return {
        path: fullPath,
        count: files.length,
        entries: files.slice(0, 30)
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // Copy file from source to vault
  copyToVault(sourcePath: string, destPath: string): ToolResult {
    try {
      const { fullPath: srcFull, error: srcErr } = this.resolvePath(sourcePath);
      if (srcErr) return { error: srcErr };

      const destFull = path.join(this.vaultPath, destPath);

      // Ensure destination is in vault
      if (!destFull.startsWith(this.vaultPath)) {
        return { error: "Destination must be in vault" };
      }

      // Create destination directory if needed
      const destDir = path.dirname(destFull);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.copyFileSync(srcFull, destFull);
      return { success: true, copied: destPath };
    } catch (err: any) {
      return { error: err.message };
    }
  }
}
