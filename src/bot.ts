// OpenClaw Lite - Telegram Bot (v4.1 - Streaming & Inline)

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

// Provider selection: MODEL_PROVIDER=claude or gemini (default: claude)
const provider = (process.env.MODEL_PROVIDER || "claude") as Provider;
const apiKey = provider === "claude" ? process.env.ANTHROPIC_API_KEY! : process.env.GOOGLE_API_KEY!;

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const agent = new OpenClawAgent(
  provider,
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
bot.command("start", (ctx) => ctx.reply(`OpenClaw Lite v4.1 [${agent.getProvider()}]\n\n인라인 모드: @봇이름 질문\nProvider 전환: /provider`));

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
      `<b>🤖 현재 Provider</b>: ${current}\n\n` +
      `<b>전환 명령어</b>\n` +
      `<code>/provider gemini</code> - Gemini로 전환 (저렴)\n` +
      `<code>/provider claude</code> - Claude로 전환 (고품질)`,
      { parse_mode: "HTML" }
    );
  }

  if (args !== "claude" && args !== "gemini") {
    return ctx.reply("❌ 유효한 provider: claude 또는 gemini");
  }

  const result = agent.switchProvider(args as "claude" | "gemini");
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

// Vector index commands
const vectorDB = new VectorDB(process.env.GOOGLE_API_KEY!, process.env.VAULT_PATH!);

bot.command("index", async (ctx) => {
  const statusMsg = await ctx.reply("🔄 인덱싱 시작...");

  try {
    await vectorDB.init();
    const { indexed, failed } = await vectorDB.indexVault((current, total) => {
      // Update progress every 50 files
      if (current % 50 === 0 || current === total) {
        ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `🔄 인덱싱 중... ${current}/${total}`
        ).catch(() => {});
      }
    });

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `✅ 인덱싱 완료\n\n성공: ${indexed}개\n실패: ${failed}개`
    );
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `❌ 인덱싱 실패: ${err.message}`
    );
  }
});

bot.command("indexstats", async (ctx) => {
  try {
    await vectorDB.init();
    const stats = await vectorDB.getStats();
    ctx.reply(
      `<b>📊 Vector Index 현황</b>\n\n` +
      `문서 수: ${stats.count}개\n` +
      `마지막 인덱싱: ${stats.lastIndexed || "없음"}`,
      { parse_mode: "HTML" }
    );
  } catch (err: any) {
    ctx.reply(`Error: ${err.message}`);
  }
});

// GraphRAG commands
bot.command("buildgraph", async (ctx) => {
  const neo4jUri = process.env.NEO4J_URI;
  const neo4jUser = process.env.NEO4J_USER;
  const neo4jPassword = process.env.NEO4J_PASSWORD;

  if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    return ctx.reply(
      "❌ Neo4j 설정 필요\n\n" +
      ".env에 추가:\n" +
      "<code>NEO4J_URI=neo4j+s://xxx.databases.neo4j.io\n" +
      "NEO4J_USER=neo4j\n" +
      "NEO4J_PASSWORD=your_password</code>",
      { parse_mode: "HTML" }
    );
  }

  const statusMsg = await ctx.reply("🔄 그래프 빌드 시작...");
  const graphDB = new GraphDB(process.env.VAULT_PATH!);

  try {
    const connected = await graphDB.init(neo4jUri, neo4jUser, neo4jPassword);
    if (!connected) {
      return ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "❌ Neo4j 연결 실패");
    }

    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⚙️ 옵시디언 링크 분석 중...");

    const { nodes, relationships } = await graphDB.buildGraph((current, total, file) => {
      if (current % 100 === 0 || current === total) {
        ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `⚙️ 그래프 빌드 중... ${current}/${total}`
        ).catch(() => {});
      }
    });

    // Invalidate context cache to use new graph schema
    agent.invalidateCache();

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `✅ 그래프 빌드 완료!\n\n` +
      `📄 문서: ${nodes}개\n` +
      `🔗 관계: ${relationships}개\n` +
      `🔄 캐시 갱신됨`
    );

    await graphDB.close();
  } catch (err: any) {
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `❌ 에러: ${err.message}`);
  }
});

bot.command("graphstats", async (ctx) => {
  const neo4jUri = process.env.NEO4J_URI;
  const neo4jUser = process.env.NEO4J_USER;
  const neo4jPassword = process.env.NEO4J_PASSWORD;

  if (!neo4jUri || !neo4jUser || !neo4jPassword) {
    return ctx.reply("❌ Neo4j 설정 필요. /buildgraph 참조");
  }

  const graphDB = new GraphDB(process.env.VAULT_PATH!);

  try {
    await graphDB.init(neo4jUri, neo4jUser, neo4jPassword);
    const stats = await graphDB.getStats();

    ctx.reply(
      `<b>🕸️ Knowledge Graph 현황</b>\n\n` +
      `📄 문서: ${stats.documents}개\n` +
      `🔗 링크: ${stats.relationships}개\n` +
      `🏷️ 태그: ${stats.tags}개`,
      { parse_mode: "HTML" }
    );

    await graphDB.close();
  } catch (err: any) {
    ctx.reply(`Error: ${err.message}`);
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

  // Send initial "thinking" message
  const thinkingMsg = await ctx.reply("🔄 생각 중...", { parse_mode: "HTML" });

  try {
    // Set userId for reminder tool
    agent.setUserId(userId);

    // Get current topic for context
    const topic = getActiveTopic(userId);
    const history = getHistory(userId, 20);

    // Update to show processing
    await ctx.api.editMessageText(
      ctx.chat.id,
      thinkingMsg.message_id,
      "⚙️ 처리 중..."
    );

    // Add topic context if exists
    const contextPrefix = topic ? `[현재 토픽: ${topic}]\n` : "";
    const { text, stats, tokens, cost } = await agent.chat(contextPrefix + userMessage, history);

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
      );
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

// Image handler (Vision)
bot.on("message:photo", async (ctx) => {
  const userId = ctx.from!.id;
  const caption = ctx.message.caption || "이 이미지를 분석해줘";

  try {
    await ctx.replyWithChatAction("typing");

    // Set userId for tools
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
    logChat(userId, "vision", caption);

    await ctx.reply(`${toHtml(text)}\n\n<code>${stats}</code>`, { parse_mode: "HTML" });
  } catch (err: any) {
    logError("ImageHandler", err);
    await ctx.reply(`Vision error: ${err.message}`);
  }
});

// Inline query handler - @botname query
bot.on("inline_query", async (ctx) => {
  const userId = ctx.from.id;

  // Auth check for inline queries
  if (userId !== ALLOWED_ID) {
    return ctx.answerInlineQuery([]);
  }

  const query = ctx.inlineQuery.query.trim();

  if (!query) {
    // Show help when no query
    const helpResult = InlineQueryResultBuilder.article(
      "help",
      "OpenClaw Lite 도움말"
    ).text("질문을 입력하면 AI가 답변합니다. 예: @봇이름 삼성전자 현재가");

    return ctx.answerInlineQuery([helpResult], { cache_time: 10 });
  }

  try {
    // Set userId
    agent.setUserId(userId);

    // Quick response without history for inline
    const { text, stats } = await agent.chat(query, []);

    // Create inline result
    const result = InlineQueryResultBuilder.article(
      `result_${Date.now()}`,
      query.substring(0, 50) + (query.length > 50 ? "..." : "")
    ).text(`${text}\n\n${stats}`, { parse_mode: "HTML" });

    await ctx.answerInlineQuery([result], { cache_time: 30 });

    // Save to conversation history
    saveConversation(userId, "user", `[Inline] ${query}`);
    saveConversation(userId, "assistant", text);
    logChat(userId, "inline", query);
  } catch (err: any) {
    logError("InlineQuery", err);

    const errorResult = InlineQueryResultBuilder.article(
      "error",
      "오류 발생"
    ).text(`Error: ${err.message}`);

    await ctx.answerInlineQuery([errorResult], { cache_time: 5 });
  }
});

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
console.log(`OpenClaw Lite v4.1 started [${provider}] - Streaming & Inline enabled`);
