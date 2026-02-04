// OpenClaw Lite - Telegram Bot (v4.7 - Full Migration from OpenClaw)

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

// Provider selection
let provider = (process.env.MODEL_PROVIDER || "auto") as Provider | "auto";
let isAutoRouting = provider === "auto";
const initialProvider: Provider = isAutoRouting ? "openai" : (provider as Provider);

let apiKey = "";
if (initialProvider === "claude") apiKey = process.env.ANTHROPIC_API_KEY!;
else if (initialProvider === "openai") apiKey = process.env.OPENAI_API_KEY!;
else apiKey = process.env.GOOGLE_API_KEY!;

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const agent = new OpenClawAgent(
  initialProvider,
  apiKey,
  process.env.VAULT_PATH!,
  path.resolve(__dirname, "../persona.json"),
  process.env.BRAVE_API_KEY,
  process.env.GOOGLE_API_KEY
);

const ALLOWED_ID = Number(process.env.ALLOWED_USER_ID);
const utility = new UtilityTools(process.env.VAULT_PATH!);

// Auth middleware
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_ID) return;
  await next();
});

// Helper for background script execution
const runJobScript = (scriptName: string, description: string) => {
  console.log(`[Cron] Starting ${description}...`);
  exec(`bash ${path.join(__dirname, "../scripts/", scriptName)}`, (err, stdout, stderr) => {
    if (err) logError(`Job ${description}`, err);
    else console.log(`[Cron] ${description} finished.`);
  });
};

// --- SCHEDULED JOBS (Migrated from OpenClaw jobs.json) ---

// 1. FnGuide Daily Morning (09:00 AM)
cron.schedule("0 9 * * *", async () => {
  console.log("[Cron] fnguide-daily started");
  await bot.api.sendMessage(ALLOWED_ID, "📊 <b>오전 FnGuide 리포트 수집 및 분석을 시작합니다.</b>", { parse_mode: "HTML" });
  runJobScript("run_scraper.sh", "FnGuide Morning Scraper");
  
  // Logic for workflow execution (invoking agent via bot)
  setTimeout(async () => {
    const prompt = "투자 동료 실행해줘. 최근 수집된 리포트를 기반으로 투자 아이디어를 추출하고 트래커를 업데이트해.";
    const { text, stats } = await agent.chat(prompt, []);
    await bot.api.sendMessage(ALLOWED_ID, `✅ <b>오전 분석 완료</b>\n\n${toHtml(text)}\n\n<code>${stats}</code>`, { parse_mode: "HTML" });
  }, 1000 * 60 * 5); // 5 min delay for scraper to finish
}, { timezone: "Asia/Seoul" });

// 2. Book Processor (06:00 AM)
cron.schedule("0 6 * * *", async () => {
  console.log("[Cron] book-processor started");
  const prompt = "📚 매일 책 KB화 작업을 시작합니다. G드라이브의 신규 PDF를 확인하고 지식 베이스로 변환해줘.";
  const { text } = await agent.chat(prompt, []);
  await bot.api.sendMessage(ALLOWED_ID, `📚 <b>도서 처리 결과</b>\n\n${toHtml(text)}`, { parse_mode: "HTML" });
}, { timezone: "Asia/Seoul" });

// 3. FnGuide Evening (09:00 PM)
cron.schedule("0 21 * * *", async () => {
  console.log("[Cron] fnguide-evening started");
  await bot.api.sendMessage(ALLOWED_ID, "📊 <b>저녁 FnGuide 리포트 수집 및 분석을 시작합니다.</b>", { parse_mode: "HTML" });
  runJobScript("run_scraper.sh", "FnGuide Evening Scraper");
}, { timezone: "Asia/Seoul" });

// 4. Tracker Price Update (11:00 AM & 04:00 PM Weekdays)
cron.schedule("0 11,16 * * 1-5", async () => {
  console.log("[Cron] tracker-price started");
  const prompt = "📊 투자아이디어 트래커 현재가 업데이트 진행해줘. 트리거 근접 종목이 있으면 알려줘.";
  const { text } = await agent.chat(prompt, []);
  await bot.api.sendMessage(ALLOWED_ID, `📊 <b>트래커 업데이트</b>\n\n${toHtml(text)}`, { parse_mode: "HTML" });
}, { timezone: "Asia/Seoul" });

// 5. Daily News Summary (03:40 PM Weekdays)
cron.schedule("40 15 * * 1-5", async () => {
  console.log("[Cron] daily-news-summary started");
  const prompt = "오늘의 주요 투자 뉴스 요약해줘.";
  const { text } = await agent.chat(prompt, []);
  await bot.api.sendMessage(ALLOWED_ID, `📰 <b>오늘의 뉴스 요약</b>\n\n${toHtml(text)}`, { parse_mode: "HTML" });
}, { timezone: "Asia/Seoul" });

// --- COMMANDS ---
bot.command("start", (ctx) => ctx.reply(`OpenClaw Lite v4.7 [${isAutoRouting ? "Auto" : agent.getProvider()}]\n\n인라인 모드: @봇이름 질문\nProvider 전환: /provider`));

bot.command("clear", async (ctx) => {
  clearHistory(ctx.from!.id);
  clearActiveTopic(ctx.from!.id);
  ctx.reply("History and topic cleared.");
});

bot.command("stats", async (ctx) => {
  const stats = getUsageStats(ctx.from!.id, 7);
  if (!stats.length) return ctx.reply("No usage data.");
  const lines = stats.map((s: any) => `${s.date}: ${s.total_messages}msg, ${s.total_tokens}T, ${s.total_cost?.toFixed(1)}원`);
  ctx.reply(`<b>Usage (7 days)</b>\n<code>${lines.join("\n")}</code>`, { parse_mode: "HTML" });
});

bot.command("provider", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim().toLowerCase() || "";
  const current = agent.getProvider();

  if (!args) {
    return ctx.reply(
      `<b>🤖 현재 Mode</b>: ${isAutoRouting ? "Auto Routing" : current}\n\n` +
      `<b>전환 명령어</b>\n` +
      `<code>/provider auto</code> - 스마트 자동 선택 (권장)\n` +
      `<code>/provider openai</code> - OpenAI 고정 (가성비)\n` +
      `<code>/provider claude</code> - Claude 고정 (고품질)\n` +
      `<code>/provider gemini</code> - Gemini 고정 (초저렴)`,
      { parse_mode: "HTML" }
    );
  }

  if (args === "auto") {
    isAutoRouting = true;
    return ctx.reply("✅ <b>스마트 라우팅 모드</b>가 활성화되었습니다. 질문의 난이도에 따라 모델을 자동 선택합니다.", { parse_mode: "HTML" });
  }

  if (args !== "claude" && args !== "gemini" && args !== "openai") {
    return ctx.reply("❌ 유효한 provider: auto, claude, gemini, openai");
  }

  isAutoRouting = false;
  const result = agent.switchProvider(args as Provider);
  if (result.success) {
    ctx.reply(`✅ ${result.message}\n\n현재 Provider: <b>${agent.getProvider()}</b>`, { parse_mode: "HTML" });
  } else {
    ctx.reply(`❌ ${result.message}`);
  }
});

// Markdown to Telegram HTML
function toHtml(text: string): string {
  let html = text;
  html = html.replace(/^#{1,3}\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__(.*?)__/g, "<b>$1</b>");
  html = html.replace(/([^*]|^)\*(?!\s)([^*]+)(?<!\s)\*/g, "$1<i>$2</i>");
  html = html.replace(/^\s*[-*]\s+/gm, "• ");
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre>$1</pre>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

// Text message handler with streaming UI
bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const userMessage = ctx.message.text;

  const thinkingMsg = await ctx.reply("🔄 생각 중...", { parse_mode: "HTML" });

  try {
    agent.setUserId(userId);

    if (isAutoRouting) {
      await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, "🤖 질문 의도 분석 중...");
      const targetProvider = await agent.determineRoute(userMessage);
      agent.switchProvider(targetProvider);
    }

    const topic = getActiveTopic(userId);
    const history = getHistory(userId, 20);

    await ctx.api.editMessageText(
      ctx.chat.id,
      thinkingMsg.message_id,
      `⚙️ ${agent.getProvider()}가 처리 중...`
    );

    let lastUpdate = Date.now();
    const updateInterval = 800;

    const contextPrefix = topic ? `[현재 토픽: ${topic}]\n` : "";
    const { text, stats, tokens, cost } = await agent.chat(
      contextPrefix + userMessage, 
      history,
      async (chunk) => {
        const now = Date.now();
        if (now - lastUpdate > updateInterval) {
          lastUpdate = now;
          await ctx.api.editMessageText(
            ctx.chat.id,
            thinkingMsg.message_id,
            `${toHtml(chunk)}\n\n⏳ <i>작성 중...</i>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }
    );

    saveConversation(userId, "user", userMessage);
    saveConversation(userId, "assistant", text, tokens, cost);
    logChat(userId, "user", userMessage);
    logChat(userId, "assistant", text, tokens, stats);

    const finalText = `${toHtml(text)}\n\n<code>${stats}</code>`;

    if (finalText.length > 4000) {
      await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id);
      const chunks = splitMessage(finalText, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: "HTML" });
      }
    } else {
      await ctx.api.editMessageText(
        ctx.chat.id,
        thinkingMsg.message_id,
        finalText,
        { parse_mode: "HTML" }
      ).catch(() => {
        ctx.reply(finalText, { parse_mode: "HTML" });
      });
    }
  } catch (err: any) {
    logError("TextHandler", err);
    await ctx.api.editMessageText(
      ctx.chat.id,
      thinkingMsg.message_id,
      `❌ Error: ${err.message}`
    );
  }
});

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = text;
  while (current.length > maxLength) {
    let splitAt = current.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;
    chunks.push(current.substring(0, splitAt));
    current = current.substring(splitAt).trim();
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// Image handler (Vision)
bot.on("message:photo", async (ctx) => {
  const userId = ctx.from!.id;
  const caption = ctx.message.caption || "이 이미지를 분석해줘";
  try {
    await ctx.replyWithChatAction("typing");
    agent.setUserId(userId);
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg";
    const { text, stats } = await agent.chatWithImage(caption, buffer, mimeType);
    saveConversation(userId, "user", `[Image] ${caption}`);
    saveConversation(userId, "assistant", text);
    await ctx.reply(`${toHtml(text)}\n\n<code>${stats}</code>`, { parse_mode: "HTML" });
  } catch (err: any) {
    logError("ImageHandler", err);
    await ctx.reply(`Vision error: ${err.message}`);
  }
});

// Document handler (PDF, Files)
bot.on("message:document", async (ctx) => {
  const userId = ctx.from!.id;
  const doc = ctx.message.document;
  const caption = ctx.message.caption || "이 문서를 분석하고 투자 아이디어를 추출해줘";

  if (!doc.file_name?.toLowerCase().endsWith(".pdf")) {
    return ctx.reply("현재는 PDF 파일 분석만 지원합니다.");
  }

  const thinkingMsg = await ctx.reply("🔄 <b>문서 분석 중...</b> (텍스트 추출 및 요약)", { parse_mode: "HTML" });

  try {
    const file = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    // Save file locally for analysis
    const buffer = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());
    const tempPath = path.join("/tmp", doc.file_name);
    fs.writeFileSync(tempPath, buffer);

    const prompt = `[첨부파일: ${doc.file_name}]\n${caption}\n\n위 문서를 읽고 '투자 동료 워크플로우'를 따라 투자 아이디어를 추출해줘.`;
    
    const { text, stats } = await agent.chat(prompt, []); // PDF reading happens via tools in agent.chat
    
    await ctx.api.editMessageText(
      ctx.chat.id,
      thinkingMsg.message_id,
      `${toHtml(text)}\n\n<code>${stats}</code>`,
      { parse_mode: "HTML" }
    );
  } catch (err: any) {
    logError("DocHandler", err);
    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, `❌ 문서 분석 실패: ${err.message}`);
  }
});

// Reminder scheduler
cron.schedule("* * * * *", async () => {
  const pendingReminders = getPendingReminders();
  for (const reminder of pendingReminders) {
    try {
      await bot.api.sendMessage(reminder.user_id, `⏰ <b>리마인더</b>\n\n${reminder.message}`, { parse_mode: "HTML" });
      markReminderSent(reminder.id);
    } catch (err) {
      logError("ReminderScheduler", err);
    }
  }
});

bot.start();
console.log(`OpenClaw Lite v4.7 started [${isAutoRouting ? "auto" : provider}] - Full Migration Complete`);