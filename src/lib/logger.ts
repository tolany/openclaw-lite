// OpenClaw Lite - Winston Logger

import * as winston from "winston";
import * as path from "path";
import * as fs from "fs";

const logsDir = path.resolve(__dirname, "../../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
      return `[${timestamp}] ${level.toUpperCase()}: ${message} ${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: path.join(logsDir, "error.log"), level: "error" }),
    new winston.transports.File({ filename: path.join(logsDir, "combined.log") })
  ]
});

// Console output in development
if (process.env.NODE_ENV !== "production") {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Tool call logger
export function logTool(toolName: string, args: any, result: any) {
  logger.info(`Tool: ${toolName}`, { args, resultKeys: Object.keys(result) });
}

// Chat logger
export function logChat(userId: number, role: string, preview: string, tokens?: number, cost?: string) {
  logger.info(`Chat [${userId}] ${role}`, { preview: preview.substring(0, 50), tokens, cost });
}

// Error logger
export function logError(context: string, error: any) {
  logger.error(`${context}: ${error.message || error}`);
}

export default logger;
