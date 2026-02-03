import { Bot } from "grammy";
import * as dotenv from "dotenv";
import * as path from "path";
import { OpenClawAgent } from "./agent";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// 환경변수 체크
const requiredVars = ["TELEGRAM_BOT_TOKEN", "ALLOWED_USER_ID", "GOOGLE_API_KEY", "VAULT_PATH"];
const missingVars = requiredVars.filter(key => !process.env[key]);

if (missingVars.length > 0) {
  console.error(`❌ Missing .env variables: ${missingVars.join(", ")}`);
  process.exit(1);
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const agent = new OpenClawAgent(
  process.env.GOOGLE_API_KEY!,
  process.env.VAULT_PATH!,
  path.resolve(__dirname, "../persona.json")
);

const chatHistory: any[] = [];
const ALLOWED_ID = Number(process.env.ALLOWED_USER_ID);

bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_ID) return;
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

    await ctx.reply(response, { parse_mode: "Markdown" });
  } catch (err: any) {
    if (err.message?.includes("can't parse entities") && response) {
      await ctx.reply("⚠️ (Text Mode)\n\n" + response);
    } else {
      await ctx.reply(`⚠️ Error: ${err.message}`);
    }
  }
});

bot.start();
