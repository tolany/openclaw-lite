// OpenClaw Lite - Utility Tools (PDF, Reminders, Obsidian, Health)

import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require("pdf-parse");

export class UtilityTools {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  // PDF 파싱
  async readPdf(filePath: string): Promise<{ success: boolean; content?: string; pages?: number; error?: string }> {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(this.vaultPath, filePath);

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: "File not found" };
      }

      const dataBuffer = fs.readFileSync(fullPath);
      const data = await pdf(dataBuffer);

      // 텍스트 정리 (과도한 공백 제거)
      const cleanText = data.text
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

      // 최대 15000자로 제한
      const truncated = cleanText.length > 15000
        ? cleanText.substring(0, 15000) + "\n\n[...truncated, total chars: " + cleanText.length + "]"
        : cleanText;

      return {
        success: true,
        content: truncated,
        pages: data.numpages
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Obsidian 딥링크 생성
  createObsidianLink(filePath: string, vaultName: string = "Tolany Vault"): string {
    // 경로에서 vault 이름 제거하고 상대 경로만 사용
    let relativePath = filePath;
    if (filePath.startsWith(this.vaultPath)) {
      relativePath = filePath.substring(this.vaultPath.length);
    }
    if (relativePath.startsWith("/")) {
      relativePath = relativePath.substring(1);
    }

    const encodedVault = encodeURIComponent(vaultName);
    const encodedFile = encodeURIComponent(relativePath);
    return `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;
  }

  // 시스템 상태 체크
  async healthCheck(): Promise<{
    vault: boolean;
    database: boolean;
    brave: boolean;
    uptime: number;
    memory: { used: number; total: number };
  }> {
    const dbPath = path.resolve(__dirname, "../../data/openclaw.db");

    return {
      vault: fs.existsSync(this.vaultPath),
      database: fs.existsSync(dbPath),
      brave: !!process.env.BRAVE_API_KEY,
      uptime: Math.floor(process.uptime()),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };
  }
}
