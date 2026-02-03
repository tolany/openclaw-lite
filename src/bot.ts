import { Bot } from "grammy";
import * as dotenv from "dotenv";
import * as path from "path";
import { OpenClawAgent } from "./agent";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = Number(process.env.ALLOWED_USER_ID);
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; 
const VAULT_PATH = process.env.VAULT_PATH || "/home/jblee/obsidian-vault";

if (!BOT_TOKEN || !ALLOWED_USER_ID || !GOOGLE_API_KEY) {
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const agent = new OpenClawAgent(
  GOOGLE_API_KEY, 
  VAULT_PATH, 
  path.resolve(__dirname, "../persona.json")
);

const chatHistory: any[] = [];

bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER_ID) return;
  await next();
});

bot.command("start", (ctx) => ctx.reply("🤖 OpenClaw Lite is Online!"));
bot.command("clear", (ctx) => {
  chatHistory.length = 0;
  ctx.reply("🧹 Chat history cleared.");
});

bot.on("message:text", async (ctx) => {
  let response = "";
  try {
    const userMessage = ctx.message.text;
    await ctx.replyWithChatAction("typing");
    response = await agent.chat(userMessage, chatHistory);
    
    chatHistory.push({ role: "user", content: userMessage });
    chatHistory.push({ role: "assistant", content: response });
    if (chatHistory.length > 20) chatHistory.splice(0, 2);

    // HTML 모드로 전송
    await ctx.reply(response, { parse_mode: "HTML" });
  } catch (err: any) {
    // HTML 파싱 에러 발생 시, 텍스트 모드로 재전송 (태그 제거 등)
    if (err.message && (err.message.includes("can't parse entities") || err.message.includes("Bad Request"))) {
      try {
        await ctx.reply("⚠️ (포맷 오류로 원본 텍스트 전송)\n\n" + response);
      } catch (fallbackErr) {
        await ctx.reply("❌ 응답 전송 실패");
      }
    } else {
      await ctx.reply(`⚠️ Error: ${err.message}`);
    }
  }
});

bot.start();
