import { Bot } from "grammy";
import * as dotenv from "dotenv";
import * as path from "path";
import { OpenClawAgent } from "./agent";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

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

// 마크다운 -> 텔레그램 HTML 변환기
function convertMarkdownToHtml(text: string): string {
  let html = text;
  
  // 1. Bold: **text** -> <b>text</b>
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  
  // 2. Bold (alternative): __text__ -> <b>text</b>
  html = html.replace(/__(.*?)__/g, '<b>$1</b>');

  // 3. Italic: *text* -> <i>text</i> (단, 불렛 포인트 * 제외)
  //    불렛이 아닌 *문자* 패턴만 매칭
  html = html.replace(/([^*]|^)\*(?!\s)(.*?)(?<!\s)\*/g, '$1<i>$2</i>');

  // 4. List Item: * Item -> - Item (텔레그램은 <ul> 미지원하므로 하이픈으로 통일)
  html = html.replace(/^\s*\*\s+/gm, '- ');

  // 5. Code Block: ```code``` -> <pre>code</pre>
  html = html.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');

  // 6. Inline Code: `code` -> <code>code</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  return html;
}

bot.on("message:text", async (ctx) => {
  let replyStats = "";

  try {
    const userMessage = ctx.message.text;
    await ctx.replyWithChatAction("typing");
    
    const { text, stats } = await agent.chat(userMessage, chatHistory);
    replyStats = stats;
    
    chatHistory.push({ role: "user", content: userMessage });
    chatHistory.push({ role: "assistant", content: text });
    if (chatHistory.length > 20) chatHistory.splice(0, 2);

    // 변환기 가동
    const safeHtml = convertMarkdownToHtml(text);
    const finalMessage = `${safeHtml}\n\n<code>${stats}</code>`;
    
    await ctx.reply(finalMessage, { parse_mode: "HTML" });

  } catch (err: any) {
    console.error("⚠️ Send Error:", err.message);
    
    // 변환 실패 시 텍스트 모드로 전송하되, 비용 정보는 포함
    try {
        // 원본 텍스트라도 보내본다
        const { text } = chatHistory[chatHistory.length - 1]; // 방금 생성한 텍스트
        await ctx.reply(`${text}\n\n${replyStats} (Text Mode)`);
    } catch (finalErr) {
        await ctx.reply(`❌ Critical Error: ${err.message}`);
    }
  }
});

bot.start();
