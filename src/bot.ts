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
  return text.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>").replace(/^\s*[-*]\s+/gm, "• ").replace(/`([^`]+)`/g, "<code>$1</code>");
}

// ============================================
// SCHEDULED JOBS (Migrated from OpenClaw)
// ============================================

// Helper: Run agent task and send result to Telegram
async function runScheduledTask(taskName: string, prompt: string, emoji: string = "📊") {
  if (!agent) {
    console.log(`[Cron] ${taskName}: Agent not ready, skipping`);
    return;
  }
  try {
    console.log(`[Cron] ${taskName}: Starting...`);
    const { text } = await agent.chat(prompt, []);
    await bot.api.sendMessage(ALLOWED_ID, `${emoji} <b>${taskName}</b>\n\n${textToHtml(text)}`, { parse_mode: "HTML" });
    console.log(`[Cron] ${taskName}: Completed`);
  } catch (err: any) {
    console.error(`[Cron] ${taskName} failed:`, err.message);
    bot.api.sendMessage(ALLOWED_ID, `❌ ${taskName} 실패: ${err.message}`).catch(() => {});
  }
}

// 1. Book Processor - 매일 6시
cron.schedule("0 6 * * *", () => runScheduledTask(
  "책 KB화 작업",
  `📚 매일 책 KB화 작업 (템플릿 적용)

## 사전 체크
- G: 드라이브 마운트 확인: ls /mnt/g/내\\ 드라이브/00_Archive/R40/OCR\\ 완료/ | head -3
- 마운트 안 됐으면: sudo mount -t drvfs G: /mnt/g

## 처리 절차
1. 03_knowledge-base/books/_tracker.json 확인
2. 아직 처리 안 된 책 1권 선택 (sourcePath에서)
3. 책 분류 판단 (제목/목차 기반)
4. pdftotext로 텍스트 추출
5. 템플릿 적용 (01_contexts/templates/book-to-knowledge-template.md 참조)
6. 트래커 업데이트 (processed 배열에 추가)
7. git commit & push
8. 처리한 책 + 핵심 1줄 알려줘`,
  "📚"
), { timezone: "Asia/Seoul" });

// 2. Daily PE English - 매일 8시
cron.schedule("0 8 * * *", () => runScheduledTask(
  "PE/VC 영어 학습",
  `📚 PE/VC 비즈니스 영어 Daily Learning

## 참조 파일
03_knowledge-base/english/PE_VC_Business_English.md

## 오늘의 학습 자료 생성

### 형식
1. **오늘의 상황** (랜덤 선택)
   - IC 미팅 / LP 업데이트 콜 / 딜 소싱 미팅 / 포트폴리오 경영진 미팅 / 협상 중 하나

2. **핵심 표현 5개**
   - 영어 표현
   - 한글 뜻
   - 사용 맥락 (언제, 어떤 상황에서)
   - 예문 1개

3. **오늘의 대화 스크립트** (A/B 롤플레이, 10문장 이내)
   - 실제 PE/VC 업무에서 벌어질 법한 상황
   - 위 핵심 표현 중 2-3개 자연스럽게 포함

4. **오늘의 도전**
   - 위 표현 중 하나를 활용해 본인 상황에 맞게 문장 만들어보기 과제

### 톤
- 격식 있는 비즈니스 영어 (Earnings Call, LP Letter 수준)
- 실제 대화체로
- 한글 번역은 자연스럽게`,
  "📚"
), { timezone: "Asia/Seoul" });

// 3. Earnings Calendar Alert - 평일 8시
cron.schedule("5 8 * * 1-5", () => runScheduledTask(
  "실적 발표 캘린더",
  `📅 실적 발표 캘린더 체크:
오늘/내일 실적 발표 예정인 트래커 종목 확인
있으면 컨센서스, 주요 체크포인트 포함해서 알려줘
없으면 "오늘/내일 실적 발표 예정 종목 없음"이라고만 알려줘`,
  "📅"
), { timezone: "Asia/Seoul" });

// 4. FnGuide Morning - 9시
cron.schedule("0 9 * * *", async () => {
  bot.api.sendMessage(ALLOWED_ID, "📊 FnGuide 오전 스캔 시작...").catch(() => {});
  exec(`bash ${path.join(__dirname, "../scripts/run_scraper.sh")}`, async (err) => {
    if (err) {
      bot.api.sendMessage(ALLOWED_ID, `❌ FnGuide 스크래핑 실패: ${err.message}`).catch(() => {});
      return;
    }
    // After scraping, run investment idea monitoring
    await runScheduledTask(
      "오전 투자 아이디어 모니터링",
      `FnGuide 증권사 리포트 오전 수집 완료.

## 실행 순서
1. KB 저장 확인
2. 투자논리_아이디어_모니터링 워크플로우 실행 (01_contexts/workflows/투자논리_아이디어_모니터링.md)
3. 투자아이디어_트래커 업데이트
4. 관련 종목 추정실적_트래커 업데이트
5. 오전 수집분 결과 요약해줘`,
      "📊"
    );
  });
}, { timezone: "Asia/Seoul" });

// 5. Tracker Price Update - 평일 11시, 16시
cron.schedule("0 11,16 * * 1-5", () => runScheduledTask(
  "트래커 현재가 업데이트",
  `📊 투자아이디어 트래커 현재가 업데이트:
네이버 금융에서 트래커 종목들 현재가 조회
투자아이디어_트래커.md, _02_A_고우선.md, _03_B_관심.md 현재가 업데이트
git commit & push
주요 변동 알림 (트리거 근접 종목 강조)`,
  "📊"
), { timezone: "Asia/Seoul" });

// 6. Daily News Summary - 평일 15:40
cron.schedule("40 15 * * 1-5", () => runScheduledTask(
  "오늘의 투자 브리핑",
  `📰 장 마감 후 뉴스 요약:

1. 오늘 주요 시장 뉴스 검색 (web_search)
2. 트래커 종목 관련 뉴스 체크
3. 실적 공시 채널에서 주요 공시 정리
4. 증권사리포트_요약 파일에서 오늘 추가된 리포트 요약
5. '오늘의 투자 브리핑' 형식으로 요약해줘`,
  "📰"
), { timezone: "Asia/Seoul" });

// 7. Weekly Portfolio Review - 일요일 20시
cron.schedule("0 20 * * 0", () => runScheduledTask(
  "주간 포트폴리오 리뷰",
  `📊 주간 포트폴리오 리뷰:

1. 포트폴리오 현황 체크 (11_개인투자/_data/)
2. 주간 수익률 계산
3. 트래커 종목 주간 변동 분석
4. 트리거 도달/근접 종목 정리
5. 다음 주 주요 이벤트 (실적 발표 등) 정리
6. '주간 투자 리뷰' 형식으로 정리해줘`,
  "📊"
), { timezone: "Asia/Seoul" });

// 8. FnGuide Evening - 21시
cron.schedule("0 21 * * *", async () => {
  bot.api.sendMessage(ALLOWED_ID, "📊 FnGuide 저녁 스캔 시작...").catch(() => {});
  exec(`bash ${path.join(__dirname, "../scripts/run_scraper.sh")}`, async (err) => {
    if (err) {
      bot.api.sendMessage(ALLOWED_ID, `❌ FnGuide 스크래핑 실패: ${err.message}`).catch(() => {});
      return;
    }
    await runScheduledTask(
      "저녁 투자 아이디어 모니터링",
      `FnGuide 증권사 리포트 저녁 수집 완료.

## 실행 순서
1. KB 저장 확인
2. 투자논리_아이디어_모니터링 워크플로우 실행
3. 투자아이디어_트래커 업데이트
4. 관련 종목 추정실적_트래커 업데이트
5. 저녁 수집분 결과 요약해줘`,
      "📊"
    );
  });
}, { timezone: "Asia/Seoul" });

// 9. KNOU Tuition Reminders (One-time, Feb 23-24, 2026)
const knouEveDate = new Date("2026-02-23T21:00:00+09:00");
const knouDayDate = new Date("2026-02-24T09:00:00+09:00");
const now = new Date();

if (now < knouEveDate) {
  const msUntilEve = knouEveDate.getTime() - now.getTime();
  setTimeout(() => {
    bot.api.sendMessage(ALLOWED_ID, `🎓 [리마인더] 방송통신대학교 등록금 최종 납부 기간이 내일(2/24)부터 시작됩니다!

📅 기간: 2/24(화) ~ 2/26(목)
💳 납부방법: 가상계좌, 카드(삼성/국민 무이자), 은행 방문
🔗 MyKnou학사정보 → 등록 → 등록금 조회/납부

⚠️ 미등록 시 제적 처리될 수 있으니 꼭 납부해주세요!`).catch(() => {});
  }, msUntilEve);
  console.log(`[Cron] KNOU reminder (eve) scheduled for ${knouEveDate.toISOString()}`);
}

if (now < knouDayDate) {
  const msUntilDay = knouDayDate.getTime() - now.getTime();
  setTimeout(() => {
    bot.api.sendMessage(ALLOWED_ID, `🎓 [리마인더] 오늘부터 방송통신대학교 등록금 최종 납부 기간입니다!

📅 오늘 2/24(화) ~ 2/26(목) 마감
⏰ 납부 시간: 09:00 ~ 22:00
💳 카드 무이자: 삼성(2~3개월), 국민(2~6개월)

오늘 납부 완료하시고 알려주세요!`).catch(() => {});
  }, msUntilDay);
  console.log(`[Cron] KNOU reminder (day) scheduled for ${knouDayDate.toISOString()}`);
}

console.log("OpenClaw Lite v5.1 - All Cron Jobs Migrated.");
