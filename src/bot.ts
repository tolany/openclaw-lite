// OpenClaw Lite - Telegram Bot (v3.0 - Multi-provider)

import { Bot } from "grammy";
import * as dotenv from "dotenv";
import * as path from "path";
import { OpenClawAgent, Provider } from "./agent";
import { saveConversation, getHistory, clearHistory, getUsageStats } from "./lib/db";
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
  process.env.BRAVE_API_KEY
);

const ALLOWED_ID = Number(process.env.ALLOWED_USER_ID);

// Auth middleware
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_ID) return;
  await next();
});

// Commands
bot.command("start", (ctx) => ctx.reply(`OpenClaw Lite v3.0 [${provider}]`));

bot.command("clear", async (ctx) => {
  clearHistory(ctx.from!.id);
  ctx.reply("History cleared.");
});

bot.command("stats", async (ctx) => {
  const stats = getUsageStats(ctx.from!.id, 7);
  if (!stats.length) return ctx.reply("No usage data.");
  const lines = stats.map((s: any) => `${s.date}: ${s.total_messages}msg, ${s.total_tokens}T, ${s.total_cost?.toFixed(1)}원`);
  ctx.reply(`<b>Usage (7 days)</b>\n<code>${lines.join("\n")}</code>`, { parse_mode: "HTML" });
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

// Text message handler
bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const userMessage = ctx.message.text;

  try {
    await ctx.replyWithChatAction("typing");
    const history = getHistory(userId, 20);
    const { text, stats, tokens, cost } = await agent.chat(userMessage, history);

    saveConversation(userId, "user", userMessage);
    saveConversation(userId, "assistant", text, tokens, cost);
    logChat(userId, "user", userMessage);
    logChat(userId, "assistant", text, tokens, stats);

    await ctx.reply(`${toHtml(text)}\n\n<code>${stats}</code>`, { parse_mode: "HTML" });
  } catch (err: any) {
    logError("TextHandler", err);
    await ctx.reply(`Error: ${err.message}`);
  }
});

// Image handler (Vision)
bot.on("message:photo", async (ctx) => {
  const userId = ctx.from!.id;
  const caption = ctx.message.caption || "이 이미지를 분석해줘";

  try {
    await ctx.replyWithChatAction("typing");
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

bot.start();
console.log(`OpenClaw Lite v3.0 started [${provider}]`);
