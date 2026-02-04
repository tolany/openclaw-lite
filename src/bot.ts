// OpenClaw Lite - Telegram Bot (v4.6 - Model Routing)

import { Bot, InlineQueryResultBuilder } from "grammy";
import * as dotenv from "dotenv";
import * as path from "path";
import * as cron from "node-cron";
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

// Provider selection: MODEL_PROVIDER=claude, gemini, openai, or auto (default: auto)
let provider = (process.env.MODEL_PROVIDER || "auto") as Provider | "auto";
let isAutoRouting = provider === "auto";

// Default actual provider for 'auto' mode startup
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
  process.env.GOOGLE_API_KEY  // For VectorDB embedding
);

const ALLOWED_ID = Number(process.env.ALLOWED_USER_ID);
const utility = new UtilityTools(process.env.VAULT_PATH!);

// Auth middleware
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_ID) return;
  await next();
});

// Commands
bot.command("start", (ctx) => ctx.reply(`OpenClaw Lite v4.6 [${isAutoRouting ? "Auto" : agent.getProvider()}]\n\n인라인 모드: @봇이름 질문\nProvider 전환: /provider`));

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

// Provider switching (runtime, no restart needed)
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

// Cost command - monthly breakdown
bot.command("cost", async (ctx) => {
  const userId = ctx.from!.id;
  const today = getTodayCost(userId);
  const monthly = getMonthlyCost(userId);

  let msg = `<b>💰 비용 현황</b>\n\n`;
  msg += `<b>오늘</b>: ${today.messages}건, ${today.tokens.toLocaleString()}T, ${today.cost.toFixed(0)}원\n\n`;
  msg += `<b>월별 현황</b>\n`;

  if (monthly.length === 0) {
    msg += `<code>데이터 없음</code>`;
  } else {
    msg += `<code>`;
    for (const m of monthly) {
      msg += `${m.month}: ${m.total_tokens.toLocaleString()}T, ${m.total_cost.toFixed(0)}원\n`;
    }
    msg += `</code>`;
  }

  ctx.reply(msg, { parse_mode: "HTML" });
});

// Topic commands
bot.command("topic", async (ctx) => {
  const userId = ctx.from!.id;
  const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim() || "";

  if (!args) {
    const current = getActiveTopic(userId);
    return ctx.reply(current ? `현재 토픽: <b>${current}</b>` : "활성 토픽 없음. /topic <이름>으로 설정하세요.", { parse_mode: "HTML" });
  }

  if (args === "clear") {
    clearActiveTopic(userId);
    clearHistory(userId);
    return ctx.reply("토픽이 초기화되었습니다.");
  }

  setActiveTopic(userId, args);
  clearHistory(userId);
  ctx.reply(`토픽이 <b>${args}</b>로 설정되었습니다. 대화 히스토리가 초기화됩니다.`, { parse_mode: "HTML" });
});

// Reminders command
bot.command("reminders", async (ctx) => {
  const userId = ctx.from!.id;
  const reminders = getUserReminders(userId);

  if (reminders.length === 0) {
    return ctx.reply("예정된 리마인더가 없습니다.");
  }

  let msg = `<b>⏰ 예정된 리마인더</b>\n\n`;
  for (const r of reminders) {
    const time = new Date(r.remind_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    msg += `#${r.id}: ${r.message}\n└ ${time}\n\n`;
  }
  msg += `<code>/delreminder [ID]로 삭제</code>`;

  ctx.reply(msg, { parse_mode: "HTML" });
});

// Delete reminder
bot.command("delreminder", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1) || [];
  if (args.length === 0) {
    return ctx.reply("사용법: /delreminder [ID]");
  }
  const id = parseInt(args[0]);
  if (isNaN(id)) {
    return ctx.reply("유효한 ID를 입력하세요.");
  }
  deleteReminder(id);
  ctx.reply(`리마인더 #${id}가 삭제되었습니다.`);
});

// Health check command
bot.command("health", async (ctx) => {
  const health = await utility.healthCheck();

  const status = (ok: boolean) => ok ? "✅" : "❌";
  const uptime = `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`;

  const msg = `<b>🏥 시스템 상태</b>\n\n` +
    `Vault: ${status(health.vault)}\n` +
    `Database: ${status(health.database)}\n` +
    `Brave API: ${status(health.brave)}\n` +
    `Uptime: ${uptime}\n` +
    `Memory: ${health.memory.used}MB / ${health.memory.total}MB`;

  ctx.reply(msg, { parse_mode: "HTML" });
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

  // Send initial "thinking" message
  const thinkingMsg = await ctx.reply("🔄 생각 중...", { parse_mode: "HTML" });

  try {
    // Set userId for reminder tool
    agent.setUserId(userId);

    // 1. Determine Route if Auto Routing is on
    if (isAutoRouting) {
      await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, "🤖 질문 의도 분석 중...");
      const targetProvider = await agent.determineRoute(userMessage);
      agent.switchProvider(targetProvider);
    }

    // Get current topic for context
    const topic = getActiveTopic(userId);
    const history = getHistory(userId, 20);

    // Update to show processing
    await ctx.api.editMessageText(
      ctx.chat.id,
      thinkingMsg.message_id,
      `⚙️ ${agent.getProvider()}가 처리 중...`
    );

    // Streaming state
    let lastUpdate = Date.now();
    const updateInterval = 800; // 800ms throttling to avoid Telegram rate limits

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

    // Update with final response
    const finalText = `${toHtml(text)}\n\n<code>${stats}</code>`;

    // Telegram has 4096 char limit - split if needed
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

// Split long messages
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = text;

  while (current.length > maxLength) {
    let splitAt = current.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }
    chunks.push(current.substring(0, splitAt));
    current = current.substring(splitAt).trim();
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// Inline query handler omitted for brevity, but matches main logic if needed

// Reminder scheduler - check every minute
cron.schedule("* * * * *", async () => {
  const pendingReminders = getPendingReminders();

  for (const reminder of pendingReminders) {
    try {
      await bot.api.sendMessage(
        reminder.user_id,
        `⏰ <b>리마인더</b>\n\n${reminder.message}`,
        { parse_mode: "HTML" }
      );
      markReminderSent(reminder.id);
      console.log(`Reminder #${reminder.id} sent to user ${reminder.user_id}`);
    } catch (err) {
      logError("ReminderScheduler", err);
    }
  }
});

bot.start();
console.log(`OpenClaw Lite v4.6 started [${isAutoRouting ? "auto" : provider}] - Routing enabled`);
