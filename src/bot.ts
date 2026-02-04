// OpenClaw Lite - Telegram Bot (v5.0 - Final Integrated Version)

import { Bot, InlineQueryResultBuilder } from "grammy";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as cron from "node-cron";
import { exec } from "child_process";
import { OpenClawAgent, Provider } from "./agent";
import {
  saveConversation, getHistory, clearHistory, getUsageStats,
  getPendingReminders, markReminderSent, getUserReminders, deleteReminder,
  setActiveTopic, getActiveTopic, clearActiveTopic,
  getMonthlyCost, getTodayCost
} from "./lib/db";
import { UtilityTools } from "./tools/utility";
import { VectorDB } from "./lib/vectordb";
import { GraphDB } from "./lib/graphdb";
import { logChat, logError } from "./lib/logger";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const ALLOWED_ID = Number(process.env.ALLOWED_USER_ID);
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// --- CRITICAL: Start Polling First to ensure response ---
bot.start({
  onStart: (me) => console.log(`[Bot] @${me.username} is now active and polling!`)
}).catch(err => console.error("[Bot] Polling failed:", err));

console.log("OpenClaw Lite v5.0 - Fast Track Listener Active.");

// State variables
let isAutoRouting = (process.env.MODEL_PROVIDER || "auto") === "auto";
let agent: OpenClawAgent;
let utility: UtilityTools;

// Async Engine Loader (Non-blocking)
const initEngine = async () => {
  console.log("[Engine] Starting initialization...");
  const initialProvider = isAutoRouting ? "openai" : (process.env.MODEL_PROVIDER as Provider);
  
  const apiKey = initialProvider === "claude" ? process.env.ANTHROPIC_API_KEY! :
                 initialProvider === "openai" ? process.env.OPENAI_API_KEY! : process.env.GOOGLE_API_KEY!;

  agent = new OpenClawAgent(
    initialProvider,
    apiKey,
    process.env.VAULT_PATH!,
    path.resolve(__dirname, "../persona.json"),
    process.env.BRAVE_API_KEY,
    process.env.GOOGLE_API_KEY
  );
  
  utility = new UtilityTools(process.env.VAULT_PATH!);
  console.log("[Engine] All engines loaded and ready.");
};

initEngine();

// --- COMMANDS & HANDLERS ---

// Auth middleware
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_ID) return;
  if (!agent) return ctx.reply("⚙️ 시스템 엔진 로드 중입니다. 잠시 후 다시 보내주세요.");
  await next();
});

bot.command("start", (ctx) => ctx.reply(`OpenClaw Lite v5.0 [${isAutoRouting ? "Auto" : agent.getProvider()}]\n\n인라인 모드: @봇이름 질문\nProvider 전환: /provider`));

bot.command("provider", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim().toLowerCase() || "";
  if (!args) return ctx.reply(`현재 Mode: ${isAutoRouting ? "Auto" : agent.getProvider()}\n/provider auto | openai | claude | gemini`);
  
  if (args === "auto") {
    isAutoRouting = true;
    return ctx.reply("✅ 스마트 라우팅 활성화");
  }
  
  isAutoRouting = false;
  const result = agent.switchProvider(args as Provider);
  ctx.reply(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
});

// Text message handler with streaming
bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const userMessage = ctx.message.text;
  const thinkingMsg = await ctx.reply("🔄 생각 중...");

  try {
    agent.setUserId(userId);
    if (isAutoRouting) {
      const targetProvider = await agent.determineRoute(userMessage);
      agent.switchProvider(targetProvider);
    }

    const topic = getActiveTopic(userId);
    const history = getHistory(userId, 20);
    const contextPrefix = topic ? `[현재 토픽: ${topic}]\n` : "";

    let lastUpdate = Date.now();
    const { text, stats, tokens, cost } = await agent.chat(
      contextPrefix + userMessage, 
      history,
      async (chunk) => {
        const now = Date.now();
        if (now - lastUpdate > 1000) {
          lastUpdate = now;
          await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `${textToHtml(chunk)}\n\n⏳ 작성 중...`, { parse_mode: "HTML" }).catch(() => {});
        }
      }
    );

    saveConversation(userId, "user", userMessage);
    saveConversation(userId, "assistant", text, tokens, cost);
    
    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `${textToHtml(text)}\n\n<code>${stats}</code>`, { parse_mode: "HTML" });
  } catch (err: any) {
    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `❌ Error: ${err.message}`);
  }
});

// Photo/Screenshot handler
bot.on("message:photo", async (ctx) => {
  const thinkingMsg = await ctx.reply("🔄 <b>이미지 분석 중...</b>", { parse_mode: "HTML" });
  try {
    // Get the largest photo size
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];
    const file = await ctx.api.getFile(largestPhoto.file_id);
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    // Download image as Buffer
    const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
    const mimeType = file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg";

    // Get caption if any
    const caption = ctx.message.caption || "이 이미지를 분석해줘.";

    // Use vision-capable model
    const { text, stats } = await agent.chatWithImage(caption, buffer, mimeType);
    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `${textToHtml(text)}\n\n<code>${stats}</code>`, { parse_mode: "HTML" });
  } catch (err: any) {
    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `❌ 이미지 분석 실패: ${err.message}`);
  }
});

// Document handler
bot.on("message:document", async (ctx) => {
  if (!ctx.message.document.file_name?.toLowerCase().endsWith(".pdf")) return ctx.reply("PDF 파일만 지원합니다.");
  const thinkingMsg = await ctx.reply("🔄 <b>리포트 분석 중...</b>", { parse_mode: "HTML" });

  // Sanitize filename to prevent path traversal
  const safeFileName = path.basename(ctx.message.document.file_name).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempPath = path.join("/tmp", `openclaw_${Date.now()}_${safeFileName}`);

  try {
    const file = await ctx.api.getFile(ctx.message.document.file_id);
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(tempPath, buffer);

    const prompt = `[첨부파일: ${ctx.message.document.file_name}]\n투자 아이디어를 추출해줘.`;
    const { text, stats } = await agent.chat(prompt, []);
    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `${textToHtml(text)}\n\n<code>${stats}</code>`, { parse_mode: "HTML" });
  } catch (err: any) {
    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `❌ 실패: ${err.message}`);
  } finally {
    // Cleanup temp file
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
});

function textToHtml(text: string): string {
  // Convert markdown tables to <pre> blocks (copyable in Telegram)
  let result = text.replace(/((?:\|.+\|\n?)+)/g, (tableMatch) => {
    const lines = tableMatch.trim().split('\n');
    // Filter out separator rows (| --- | --- |)
    const dataLines = lines.filter(line => !/^[\s|:-]+$/.test(line.replace(/\|/g, '')));
    if (dataLines.length > 0) {
      // Clean up table formatting for display
      const cleanTable = dataLines.map(line => {
        return line.replace(/^\||\|$/g, '').trim();
      }).join('\n');
      return `<pre>${cleanTable}</pre>`;
    }
    return tableMatch;
  });

  return result
    // Headers (###, ##, #) -> bold
    .replace(/^#{1,3}\s+(.+)$/gm, "<b>$1</b>")
    // Bold (**text** or __text__)
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/__(.*?)__/g, "<b>$1</b>")
    // Italic (*text* or _text_) - be careful not to match bullet points
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<i>$1</i>")
    // Inline code (but not inside <pre>)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bullet points
    .replace(/^\s*[-*]\s+/gm, "• ")
    // Numbered lists (keep as is, just clean up)
    .replace(/^\s*(\d+)\.\s+/gm, "$1. ")
    // Remove horizontal rules
    .replace(/^---+$/gm, "")
    // Clean up multiple newlines
    .replace(/\n{3,}/g, "\n\n");
}

// Scheduled Jobs
cron.schedule("0 9,21 * * *", () => {
  bot.api.sendMessage(ALLOWED_ID, "📊 FnGuide 스캔 시작...").catch(() => {});
  exec(`bash ${path.join(__dirname, "../scripts/run_scraper.sh")}`);
}, { timezone: "Asia/Seoul" });

cron.schedule("0 11,16 * * 1-5", async () => {
  if (agent) {
    const { text } = await agent.chat("투자아이디어 트래커 현재가 업데이트 진행하고 주요 변동 알려줘.", []);
    bot.api.sendMessage(ALLOWED_ID, `📊 <b>트래커 업데이트</b>\n\n${textToHtml(text)}`, { parse_mode: "HTML" }).catch(() => {});
  }
}, { timezone: "Asia/Seoul" });

console.log("OpenClaw Lite v5.0 Integrated Engine Scheduled.");
