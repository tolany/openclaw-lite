// OpenClaw Lite - Main Agent (v4.5 - Streaming Support)

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { LibrarianTools, JournalistTools, WebTools, UtilityTools, getToolDeclarations } from "./tools";
import { logTool, logError } from "./lib/logger";
import { addReminder } from "./lib/db";
import { VectorDB } from "./lib/vectordb";
import { GraphDB } from "./lib/graphdb";
import { ContextCache, buildClaudeCachedSystem } from "./lib/cache";
import { ChatMessage } from "./types";

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 5000]; // ms

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isRetryable = err.status === 429 || err.status === 500 || err.status === 503 || err.message?.includes("overloaded") || err.message?.includes("rate limit");

      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        throw err;
      }

      const delay = RETRY_DELAYS[attempt];
      console.log(`[Retry] ${context} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

// Anthropic tool schema
const CLAUDE_TOOLS: Anthropic.Tool[] = [
  { name: "read_file", description: "Read file content. Supports: vault path, gdrive:path, 투자검토:path, or absolute path", input_schema: { type: "object" as const, properties: { filePath: { type: "string", description: "Path with optional prefix: gdrive:, drive:, 투자검토:, work:, personal:" } }, required: ["filePath"] } },
  { name: "search_files", description: "Find files by pattern. Prefix with gdrive:, 투자검토: etc for Drive search", input_schema: { type: "object" as const, properties: { pattern: { type: "string", description: "Glob pattern, optionally prefixed with gdrive:, 투자검토:" } }, required: ["pattern"] } },
  { name: "search_content", description: "Search inside file contents", input_schema: { type: "object" as const, properties: { query: { type: "string" }, fileType: { type: "string" }, searchIn: { type: "string", description: "Optional: gdrive:, 투자검토:, or path to search in" } }, required: ["query"] } },
  { name: "list_dir", description: "List directory contents", input_schema: { type: "object" as const, properties: { dirPath: { type: "string", description: "Directory path with optional prefix" } }, required: ["dirPath"] } },
  { name: "copy_to_vault", description: "Copy file from Drive to vault", input_schema: { type: "object" as const, properties: { sourcePath: { type: "string", description: "Source path (e.g., gdrive:path)" }, destPath: { type: "string", description: "Destination path in vault" } }, required: ["sourcePath", "destPath"] } },
  { name: "journal_memory", description: "Save to daily journal", input_schema: { type: "object" as const, properties: { content: { type: "string" }, category: { type: "string", enum: ["insight", "meeting", "todo", "idea"] } }, required: ["content", "category"] } },
  { name: "write_file", description: "Write or append to file", input_schema: { type: "object" as const, properties: { filePath: { type: "string" }, content: { type: "string" }, mode: { type: "string", enum: ["overwrite", "append"] } }, required: ["filePath", "content"] } },
  { name: "web_search", description: "Search web for real-time info", input_schema: { type: "object" as const, properties: { query: { type: "string" }, count: { type: "number" } }, required: ["query"] } },
  { name: "run_script", description: "Run automation scripts", input_schema: { type: "object" as const, properties: { scriptName: { type: "string" } }, required: ["scriptName"] } },
  { name: "read_pdf", description: "Read and parse PDF file content", input_schema: { type: "object" as const, properties: { filePath: { type: "string" } }, required: ["filePath"] } },
  { name: "set_reminder", description: "Set a reminder. Time can be relative (+30m, +1h, +1d) or ISO format", input_schema: { type: "object" as const, properties: { message: { type: "string" }, time: { type: "string" } }, required: ["message", "time"] } },
  { name: "obsidian_link", description: "Generate Obsidian deep link for a file", input_schema: { type: "object" as const, properties: { filePath: { type: "string" } }, required: ["filePath"] } },
  { name: "semantic_search", description: "Semantic/meaning-based search. Use for vague queries like '돈 많이 번 딜', '실패한 투자'. Returns similar documents by meaning, not keywords.", input_schema: { type: "object" as const, properties: { query: { type: "string", description: "Natural language query" }, topK: { type: "number", description: "Number of results (default 5)" } }, required: ["query"] } },
  { name: "graph_search", description: "GraphRAG search - finds documents AND their relationships. Use for queries about people, projects, connections. Returns direct matches + related docs through links.", input_schema: { type: "object" as const, properties: { query: { type: "string", description: "Search query" }, depth: { type: "number", description: "How many hops to traverse (default 2)" } }, required: ["query"] } },
  { name: "find_connection", description: "Find path/connection between two topics or documents", input_schema: { type: "object" as const, properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } }
];

// OpenAI tool schema (matches CLAUDE_TOOLS but format differs)
const OPENAI_TOOLS: OpenAI.Chat.ChatCompletionTool[] = CLAUDE_TOOLS.map(t => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema
  }
}));

export type Provider = "claude" | "gemini" | "openai";

// Check if token is OAuth token (Claude Max subscription)
function isOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}

// Create Anthropic client with OAuth support
function createAnthropicClient(apiKey: string): Anthropic {
  if (isOAuthToken(apiKey)) {
    // OAuth token: use authToken and special headers (Claude Code stealth mode)
    return new Anthropic({
      apiKey: "",
      authToken: apiKey,
      defaultHeaders: {
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
        "user-agent": "claude-cli/2.1.2 (external, cli)",
        "x-app": "cli"
      },
      dangerouslyAllowBrowser: true
    });
  }
  // Regular API key
  return new Anthropic({ apiKey });
}

export class OpenClawAgent {
  private provider: Provider;
  private claudeClient?: Anthropic;
  private geminiClient?: GoogleGenerativeAI;
  private openaiClient?: OpenAI;
  private apiKey: string;
  private claudeApiKey: string;
  private geminiApiKey: string;
  private openaiApiKey: string;
  private vaultPath: string;
  private persona: any;
  private projectRoot: string;

  private librarian: LibrarianTools;
  private journalist: JournalistTools;
  private web: WebTools;
  private utility: UtilityTools;
  private vectorDB: VectorDB;
  private graphDB: GraphDB;
  private contextCache: ContextCache;
  private userId: number = 0;

  constructor(provider: Provider, apiKey: string, vaultPath: string, personaPath: string, braveApiKey?: string, geminiApiKey?: string) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.vaultPath = vaultPath;
    this.projectRoot = path.dirname(personaPath);

    // Store API keys for runtime switching
    this.claudeApiKey = process.env.ANTHROPIC_API_KEY || "";
    this.geminiApiKey = geminiApiKey || process.env.GOOGLE_API_KEY || "";
    this.openaiApiKey = process.env.OPENAI_API_KEY || "";

    // Initialize clients if keys available
    if (this.claudeApiKey) this.claudeClient = createAnthropicClient(this.claudeApiKey);
    if (this.geminiApiKey) this.geminiClient = new GoogleGenerativeAI(this.geminiApiKey);
    if (this.openaiApiKey) this.openaiClient = new OpenAI({ apiKey: this.openaiApiKey });

    try {
      this.persona = JSON.parse(fs.readFileSync(personaPath, "utf-8"));
    } catch (e) {
      this.persona = { name: "Assistant", role: "Helpful Assistant", instructions: [] };
    }

    this.librarian = new LibrarianTools(vaultPath);
    this.journalist = new JournalistTools(vaultPath);
    this.web = new WebTools(braveApiKey);
    this.utility = new UtilityTools(vaultPath);

    // VectorDB uses Gemini embedding API (always use Gemini key for this)
    const vectorApiKey = geminiApiKey || process.env.GOOGLE_API_KEY || "";
    this.vectorDB = new VectorDB(vectorApiKey, vaultPath);

    // GraphDB for GraphRAG
    this.graphDB = new GraphDB(vaultPath);

    // Context caching for cost reduction
    this.contextCache = new ContextCache(vaultPath);

    // Initialize GraphDB if credentials are available
    const neo4jUri = process.env.NEO4J_URI;
    const neo4jUser = process.env.NEO4J_USER;
    const neo4jPassword = process.env.NEO4J_PASSWORD;
    if (neo4jUri && neo4jUser && neo4jPassword) {
      this.graphDB.init(neo4jUri, neo4jUser, neo4jPassword).catch(err => {
        console.log("[GraphDB] Not connected:", err.message);
      });
    }
  }

  getGraphDB(): GraphDB {
    return this.graphDB;
  }

  setUserId(userId: number) {
    this.userId = userId;
  }

  // Get current provider
  getProvider(): Provider {
    return this.provider;
  }

  // Switch provider at runtime (no restart needed)
  switchProvider(newProvider: Provider): { success: boolean; message: string } {
    if (newProvider === this.provider) {
      return { success: true, message: `이미 ${newProvider} 사용 중` };
    }

    if (newProvider === "claude") {
      if (!this.claudeApiKey) return { success: false, message: "Claude API 키가 설정되지 않음" };
      if (!this.claudeClient) this.claudeClient = createAnthropicClient(this.claudeApiKey);
      this.provider = "claude";
      this.apiKey = this.claudeApiKey;
    } else if (newProvider === "gemini") {
      if (!this.geminiApiKey) return { success: false, message: "Gemini API 키가 설정되지 않음" };
      if (!this.geminiClient) this.geminiClient = new GoogleGenerativeAI(this.geminiApiKey);
      this.provider = "gemini";
      this.apiKey = this.geminiApiKey;
    } else if (newProvider === "openai") {
      if (!this.openaiApiKey) return { success: false, message: "OpenAI API 키가 설정되지 않음" };
      if (!this.openaiClient) this.openaiClient = new OpenAI({ apiKey: this.openaiApiKey });
      this.provider = "openai";
      this.apiKey = this.openaiApiKey;
    }

    console.log(`[Agent] Switched to ${this.provider}`);
    return { success: true, message: `${this.provider}로 전환됨 ✓` };
  }

  private parseRelativeTime(timeStr: string): Date {
    const now = new Date();
    const match = timeStr.match(/^\+(\d+)([mhd])$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      switch (unit) {
        case "m": now.setMinutes(now.getMinutes() + value); break;
        case "h": now.setHours(now.getHours() + value); break;
        case "d": now.setDate(now.getDate() + value); break;
      }
      return now;
    }
    // Try parsing as ISO or natural date
    return new Date(timeStr);
  }

  private async handleToolCall(name: string, input: any): Promise<string> {
    let result: any;
    try {
      switch (name) {
        case "read_file": result = this.librarian.readFile(input.filePath); break;
        case "search_files": result = await this.librarian.searchFiles(input.pattern); break;
        case "search_content": result = this.librarian.searchContent(input.query, input.fileType, input.searchIn); break;
        case "list_dir": result = this.librarian.listDir(input.dirPath); break;
        case "copy_to_vault": result = this.librarian.copyToVault(input.sourcePath, input.destPath); break;
        case "journal_memory": result = this.journalist.journalMemory(input.content, input.category); break;
        case "write_file": result = this.journalist.writeFile(input.filePath, input.content, input.mode); break;
        case "web_search": result = await this.web.webSearch(input.query, input.count); break;
        case "run_script":
          const allowed = ["run_scraper.sh", "run_tracker.sh"];
          if (!allowed.includes(input.scriptName)) result = { error: "Unauthorized" };
          else { exec(`bash ${path.join(this.projectRoot, input.scriptName)} &`); result = { message: "Started" }; }
          break;
        case "read_pdf":
          result = await this.utility.readPdf(input.filePath);
          break;
        case "set_reminder":
          const remindAt = this.parseRelativeTime(input.time);
          if (isNaN(remindAt.getTime())) {
            result = { error: "Invalid time format" };
          } else {
            const id = addReminder(this.userId, input.message, remindAt);
            result = { success: true, id, remind_at: remindAt.toISOString() };
          }
          break;
        case "obsidian_link":
          result = { link: this.utility.createObsidianLink(input.filePath) };
          break;
        case "semantic_search":
          result = await this.vectorDB.search(input.query, input.topK || 5);
          break;
        case "graph_search":
          result = await this.graphDB.graphSearch(input.query, input.depth || 2);
          break;
        case "find_connection":
          const pathResult = await this.graphDB.findPath(input.from, input.to);
          result = { path: pathResult, connected: pathResult.length > 0 };
          break;
        default: result = { error: `Unknown: ${name}` };
      }
    } catch (err: any) { result = { error: err.message }; logError(`Tool ${name}`, err); }
    logTool(name, input, result);
    return JSON.stringify(result);
  }

  private buildSystemPrompt(bootstrap: string): string {
    // For OAuth tokens, must include Claude Code identity
    const claudeCodePrefix = isOAuthToken(this.apiKey)
      ? "You are Claude Code, Anthropic's official CLI for Claude.\n\n"
      : "";

    const personaName = this.persona.name || "Assistant";
    const userName = this.persona.context?.user_name || "사용자";
    const userRole = this.persona.context?.user_role || "";
    const responseStyle = this.persona.response_style?.default?.join("\n• ") || "";
    const toolsGuidance = this.persona.tools_guidance
      ? Object.entries(this.persona.tools_guidance).map(([k, v]) => `• ${k}: ${v}`).join("\n")
      : "";

    // All personal info comes from bootstrap (SOUL.md, USER.md, memory/)
    return `${claudeCodePrefix}You are '${personaName}', ${userName}의 투자 파트너.

# Project Context
The following project context files have been loaded:
If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance.

${bootstrap}

## Memory Recall (mandatory)
Before answering anything about investments, stocks, deals, sectors, or prior work:
1. Run semantic_search with relevant keywords
2. Check results for tracker/portfolio matches
3. Connect the information to user's holdings

If search returns nothing relevant, mention you checked.

## Response Rules (mandatory)
After searching, your response MUST include:
1. **Connection**: Link to tracker/portfolio/prior conversation
   - "트래커에 있는 XX랑 관련 있어요"
   - "어제 정리한 XX 테마예요"
   - "보유 중인 XX에 영향 있을 수 있어요"

2. **Insight**: Your opinion/analysis (1 line)
   - "밸류에이션이 좀 부담스럽네요"
   - "근데 경쟁 심화가 걱정돼요"

## Forbidden
- ❌ Generic summaries without connection
- ❌ "추가 궁금한 점이 있으면" / "도움이 되셨으면"
- ❌ Responding without searching first

## Format
- 존댓말
- Telegram HTML: <b>bold</b>, avoid markdown headers`;
  }

  // Detect if message needs context search (expanded criteria)
  private needsContextSearch(message: string): boolean {
    // Skip very short messages (greetings, commands)
    if (message.length < 30) return false;

    const patterns = [
      // 실적/재무
      /실적|earnings|매출|GPM|OPM|NIM|beat|miss|어닝/i,
      // 투자/딜
      /PE Deals|VC Deals|M&A|인수|투자|exit|딜|투심/i,
      // 정책/시장
      /트럼프|정책|규제|법안|금리|연준|Fed/i,
      // 섹터
      /섹터|업종|테마|주도주/i,
      // AI 관련
      /Anthropic|OpenAI|Claude|GPT|AI|LLM/i,
      // 산업
      /원전|반도체|메모리|네트워킹|광물|전력|SMR|HBM/i,
      // 개인투자 키워드
      /파마|하이닉스|삼성|APR|포트폴리오|매수|매도|트래커/i,
      // 커리어
      /이직|면접|이력서|연봉|커리어/i,
      // URL/리포트 공유
      /https?:\/\//,
      /요약|핵심|주요|리포트|분석/,
    ];
    return patterns.some(p => p.test(message));
  }

  // Extract search keywords from message (enhanced)
  private extractSearchKeywords(message: string): string[] {
    const keywords: string[] = [];

    // Korean company names (2-6 characters ending with common suffixes)
    const koreanCompanyPattern = /[가-힣]{2,6}(?:케미칼|전자|반도체|에너지|화학|바이오|제약|건설|중공업|금융|증권|보험|은행|카드|리서치|소재)/g;
    const koreanMatches = message.match(koreanCompanyPattern);
    if (koreanMatches) keywords.push(...koreanMatches);

    // Known company names
    const knownCompanies = [
      '롯데케미칼', '삼성전자', 'SK하이닉스', '파마리서치', 'APR', 'TSMC', '엔비디아',
      '현대차', '기아', 'LG에너지솔루션', '삼성바이오', '셀트리온', '카카오', '네이버',
      '두산에너빌리티', '한전', '한전기술', '효성중공업', '롯데정밀화학', '롯데첨단소재'
    ];
    knownCompanies.forEach(company => {
      if (message.includes(company)) keywords.push(company);
    });

    // Sector keywords
    const sectors = [
      '메모리', '반도체', '원전', 'AI', '소프트웨어', '헬스케어', '바이오', '광통신',
      'SMR', 'HBM', '전력', 'SaaS', '석유화학', '정유', '화학', '2차전지', '배터리',
      '자동차', '조선', '건설', '금융', '보험', '통신', '미디어', '게임', '엔터'
    ];
    sectors.forEach(s => {
      if (message.includes(s)) keywords.push(s);
    });

    // Deal/investment keywords
    const dealKeywords = ['투자', '딜', 'M&A', '인수', '투심', '실적', '어닝', '매출', '영업이익'];
    dealKeywords.forEach(k => {
      if (message.includes(k)) keywords.push(k);
    });

    // Remove duplicates and return top 5
    const unique = [...new Set(keywords)];
    console.log(`[AutoSearch] extracted: ${unique.join(", ")}`);
    return unique.slice(0, 5);
  }

  async chat(message: string, history: ChatMessage[] = [], onChunk?: (text: string) => void): Promise<{ text: string; stats: string; tokens: number; cost: number }> {
    let contextPrefix = "";

    // Auto-search for messages that need context
    const needsSearch = this.needsContextSearch(message);
    console.log(`[AutoSearch] needsSearch=${needsSearch}, msgLen=${message.length}`);

    if (needsSearch) {
      const keywords = this.extractSearchKeywords(message);
      console.log(`[AutoSearch] keywords=${keywords.join(", ")}`);
      if (keywords.length > 0) {
        try {
          // Search tracker and portfolio
          const searchResult = await this.vectorDB.search(keywords.join(" "), 10);
          console.log(`[AutoSearch] results=${searchResult?.results?.length || 0}`);
          const results = searchResult?.results || [];

          if (results.length > 0) {
            // Prioritize tracker and portfolio files
            const priorityFiles = ['트래커', 'tracker', '_01_S', '_02_A', '_03_B', '포트폴리오'];
            const sortedResults = results
              .filter((r: any) => r.score > 0.2)
              .sort((a: any, b: any) => {
                const aPath = a.filePath || '';
                const bPath = b.filePath || '';
                const aIsPriority = priorityFiles.some(p => aPath.includes(p));
                const bIsPriority = priorityFiles.some(p => bPath.includes(p));
                if (aIsPriority && !bIsPriority) return -1;
                if (!aIsPriority && bIsPriority) return 1;
                return (b.score || 0) - (a.score || 0);
              })
              .slice(0, 5);

            const relevantDocs = sortedResults
              .map((r: any) => {
                const title = r.title || r.filePath?.split('/').pop() || 'Unknown';
                const preview = (r.preview || '').slice(0, 150);
                const isPriority = priorityFiles.some(p => (r.filePath || '').includes(p));
                return `${isPriority ? '⭐' : '•'} ${title}: ${preview}`;
              })
              .join("\n");

            if (relevantDocs) {
              contextPrefix = `[🔍 볼트 검색 - 키워드: ${keywords.join(", ")}]
${relevantDocs}

⚠️ 검색 결과를 참고하여 응답:
- ⭐ 표시는 트래커/포트폴리오 - 반드시 연결점 찾기
- 그냥 요약 금지. 포트폴리오와 어떤 관련이 있는지 설명
- 이전에 다룬 내용이면 "어제/아까 정리한 거" 언급

[메시지]
`;
            }
          }
        } catch (e) {
          console.log("[AutoSearch] Error:", e);
        }
      }
    }

    const bootstrap = await this.getBootstrapContext();
    const systemPrompt = this.buildSystemPrompt(bootstrap);

    // Prepend context to message if we have search results
    const enrichedMessage = contextPrefix ? contextPrefix + message : message;

    if (this.provider === "claude") {
      return this.chatClaude(enrichedMessage, history, systemPrompt, onChunk);
    } else if (this.provider === "openai") {
      return this.chatOpenAI(enrichedMessage, history, systemPrompt, onChunk);
    } else {
      return this.chatGemini(enrichedMessage, history, systemPrompt, onChunk);
    }
  }

  private async chatOpenAI(message: string, history: ChatMessage[], systemPrompt: string, onChunk?: (text: string) => void) {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // GPT-4o-mini pricing (per 1M tokens)
    const INPUT_PRICE = 0.15;  // $0.15/1M input
    const OUTPUT_PRICE = 0.60; // $0.60/1M output
    const KRW_RATE = 1450;     // USD to KRW

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      let fullText = "";
      const MAX_TOOL_TURNS = 5; // ReAct loop limit
      let toolTurns = 0;

      // ReAct Loop for OpenAI
      while (toolTurns < MAX_TOOL_TURNS) {
        let toolCalls: any[] = [];

        const response = await withRetry(
          () => this.openaiClient!.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            tools: OPENAI_TOOLS,
            tool_choice: "auto",
            stream: true,
            stream_options: { include_usage: true }
          }),
          `OpenAI API (turn ${toolTurns + 1})`
        );

        fullText = "";
        for await (const chunk of response) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            if (onChunk) onChunk(fullText);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id, function: { name: "", arguments: "" } };
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
          if (chunk.usage) {
            totalInputTokens += chunk.usage.prompt_tokens;
            totalOutputTokens += chunk.usage.completion_tokens;
          }
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          break;
        }

        // Execute tools and continue loop
        toolTurns++;
        console.log(`[ReAct-OpenAI] Turn ${toolTurns}: ${toolCalls.map(tc => tc.function.name).join(", ")}`);

        const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: tc.function
          })) as any
        };
        messages.push(assistantMessage);

        for (const tc of toolCalls) {
          const result = await this.handleToolCall(tc.function.name, JSON.parse(tc.function.arguments));
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result
          });
        }
      }

      if (toolTurns >= MAX_TOOL_TURNS) {
        console.log(`[ReAct-OpenAI] Reached max turns (${MAX_TOOL_TURNS})`);
      }

      const tokens = totalInputTokens + totalOutputTokens;
      const cost = parseFloat(((totalInputTokens / 1e6 * INPUT_PRICE + totalOutputTokens / 1e6 * OUTPUT_PRICE) * KRW_RATE).toFixed(1));

      return { text: fullText, stats: `[OpenAI|T:${tokens}|${cost}원]`, tokens, cost };
    } catch (err: any) {
      logError("OpenAI", err);
      return { text: `Error: ${err.message}`, stats: "", tokens: 0, cost: 0 };
    }
  }

  private async chatClaude(message: string, history: ChatMessage[], systemPrompt: string, onChunk?: (text: string) => void) {
    const messages: Anthropic.MessageParam[] = history.map(msg => ({
      role: msg.role as "user" | "assistant", content: msg.content
    }));
    messages.push({ role: "user", content: message });

    // Claude Sonnet 4.5 pricing (per 1M tokens)
    const INPUT_PRICE = 3.0;   // $3/1M input
    const OUTPUT_PRICE = 15.0; // $15/1M output
    const KRW_RATE = 1450;     // USD to KRW

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const systemParam = isOAuthToken(this.apiKey)
      ? [
          { type: "text" as const, text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: "ephemeral" as const } },
          { type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }
        ]
      : buildClaudeCachedSystem(this.persona.instructions?.join("\n") || "", systemPrompt);

    try {
      let fullText = "";
      const MAX_TOOL_TURNS = 5; // ReAct loop limit
      let toolTurns = 0;

      // ReAct Loop: Reasoning -> Action -> Observation -> Repeat
      while (toolTurns < MAX_TOOL_TURNS) {
        let currentToolUse: any = null;
        let hasToolCall = false;

        const stream = await withRetry(
          () => this.claudeClient!.messages.create({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 4096,
            system: systemParam,
            tools: CLAUDE_TOOLS,
            messages,
            stream: true
          }),
          `Claude API (turn ${toolTurns + 1})`
        );

        fullText = "";
        for await (const event of stream) {
          if (event.type === "message_start" && event.message.usage) {
            totalInputTokens += event.message.usage.input_tokens;
          } else if (event.type === "message_delta" && (event as any).usage) {
            totalOutputTokens += (event as any).usage.output_tokens;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            if (onChunk) onChunk(fullText);
          } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            currentToolUse = event.content_block;
            currentToolUse.input = "";
            hasToolCall = true;
          } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
            currentToolUse.input += event.delta.partial_json;
          }
        }

        // If no tool call, we're done
        if (!hasToolCall || !currentToolUse) {
          break;
        }

        // Execute tool and continue loop
        toolTurns++;
        const input = JSON.parse(currentToolUse.input);
        const result = await this.handleToolCall(currentToolUse.name, input);

        console.log(`[ReAct] Turn ${toolTurns}: ${currentToolUse.name}`);

        messages.push({ role: "assistant", content: [{ type: "tool_use", id: currentToolUse.id, name: currentToolUse.name, input }] });
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: currentToolUse.id, content: result }] });
      }

      if (toolTurns >= MAX_TOOL_TURNS) {
        console.log(`[ReAct] Reached max turns (${MAX_TOOL_TURNS})`);
      }

      const tokens = totalInputTokens + totalOutputTokens;
      const cost = parseFloat(((totalInputTokens / 1e6 * INPUT_PRICE + totalOutputTokens / 1e6 * OUTPUT_PRICE) * KRW_RATE).toFixed(1));
      return { text: fullText, stats: `[Claude|T:${tokens}|${cost}원]`, tokens, cost };
    } catch (err: any) {
      logError("Claude", err);
      return { text: `Error: ${err.message}`, stats: "", tokens: 0, cost: 0 };
    }
  }

  private async chatGemini(message: string, history: ChatMessage[], systemPrompt: string, onChunk?: (text: string) => void) {
    const geminiHistory = history.map(msg => ({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] }));
    const tools = getToolDeclarations();

    try {
      const model = this.geminiClient!.getGenerativeModel({ model: "gemini-3-flash-preview", tools });
      const chat = model.startChat({ history: geminiHistory });

      let result = await withRetry(
        () => chat.sendMessageStream(`${systemPrompt}\n\nUser: ${message}`),
        "Gemini API"
      );

      let fullText = "";
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        if (onChunk) onChunk(fullText);
      }

      const response = await result.response;
      let parts = response.candidates?.[0]?.content?.parts || [];
      let calls = parts.filter((p: any) => p.functionCall);

      while (calls.length > 0) {
        const toolResponses = await Promise.all(calls.map(async (c: any) => ({
          functionResponse: { name: c.functionCall.name, response: JSON.parse(await this.handleToolCall(c.functionCall.name, c.functionCall.args)) }
        })));
        
        result = await withRetry(
          () => chat.sendMessageStream(toolResponses),
          "Gemini API (tool)"
        );

        fullText = "";
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          fullText += chunkText;
          if (onChunk) onChunk(fullText);
        }

        const nextResponse = await result.response;
        parts = nextResponse.candidates?.[0]?.content?.parts || [];
        calls = parts.filter((p: any) => p.functionCall);
      }

      // Gemini 3 Flash pricing (per 1M tokens) - approximation
      const INPUT_PRICE = 0.075;  // ~$0.075/1M input
      const OUTPUT_PRICE = 0.30;  // ~$0.30/1M output
      const KRW_RATE = 1450;

      const usage = (await result.response).usageMetadata;
      const inputTokens = usage?.promptTokenCount || 0;
      const outputTokens = usage?.candidatesTokenCount || 0;
      const tokens = usage?.totalTokenCount || 0;
      const cost = parseFloat(((inputTokens / 1e6 * INPUT_PRICE + outputTokens / 1e6 * OUTPUT_PRICE) * KRW_RATE).toFixed(1));
      return { text: fullText, stats: `[Gemini|T:${tokens}|${cost}원]`, tokens, cost };
    } catch (err: any) {
      logError("Gemini", err);
      return { text: `Error: ${err.message}`, stats: "", tokens: 0, cost: 0 };
    }
  }

  async chatWithImage(message: string, imageBuffer: Buffer, mimeType: string): Promise<{ text: string; stats: string }> {
    const bootstrap = await this.getBootstrapContext();
    const systemPrompt = this.buildSystemPrompt(bootstrap);
    const KRW_RATE = 1450;

    if (this.provider === "claude") {
      // Claude Sonnet 4.5: $3/1M input, $15/1M output
      try {
        const response = await this.claudeClient!.messages.create({
          model: "claude-sonnet-4-5-20250929", max_tokens: 4096, system: systemPrompt,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mimeType as any, data: imageBuffer.toString("base64") } },
            { type: "text", text: message }
          ]}]
        });
        const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text || "";
        const tokens = response.usage.input_tokens + response.usage.output_tokens;
        const cost = ((response.usage.input_tokens / 1e6 * 3 + response.usage.output_tokens / 1e6 * 15) * KRW_RATE).toFixed(1);
        return { text, stats: `[Claude|T:${tokens}|${cost}원]` };
      } catch (err: any) { return { text: `Error: ${err.message}`, stats: "" }; }
    } else if (this.provider === "openai") {
      // GPT-4o-mini: $0.15/1M input, $0.60/1M output
      try {
        const response = await this.openaiClient!.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: [
              { type: "text", text: message },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBuffer.toString("base64")}` } }
            ]}
          ]
        });
        const text = response.choices[0].message.content || "";
        const usage = response.usage!;
        const tokens = usage.total_tokens;
        const cost = ((usage.prompt_tokens / 1e6 * 0.15 + usage.completion_tokens / 1e6 * 0.6) * KRW_RATE).toFixed(1);
        return { text, stats: `[OpenAI|T:${tokens}|${cost}원]` };
      } catch (err: any) { return { text: `Error: ${err.message}`, stats: "" }; }
    } else {
      // Gemini 3 Flash: ~$0.075/1M input, ~$0.30/1M output
      try {
        const model = this.geminiClient!.getGenerativeModel({ model: "gemini-3-flash-preview" });
        const result = await model.generateContent([
          { text: `${systemPrompt}\n\nUser: ${message}` },
          { inlineData: { mimeType, data: imageBuffer.toString("base64") } }
        ]);
        const response = await result.response;
        const usage = response.usageMetadata;
        const tokens = usage?.totalTokenCount || 0;
        const cost = usage ? ((usage.promptTokenCount / 1e6 * 0.075 + usage.candidatesTokenCount / 1e6 * 0.3) * KRW_RATE).toFixed(1) : "0";
        return { text: response.text(), stats: `[Gemini|T:${tokens}|${cost}원]` };
      } catch (err: any) { return { text: `Error: ${err.message}`, stats: "" }; }
    }
  }

  private async getBootstrapContext(): Promise<string> {
    let context = "";
    const openclawDir = path.join(this.vaultPath, ".openclaw");

    // 1. SOUL.md - 핵심 철학 (전체 로드)
    const soulPath = path.join(openclawDir, "SOUL.md");
    if (fs.existsSync(soulPath)) {
      const soulContent = fs.readFileSync(soulPath, "utf-8");
      context += `\n[SOUL.md - 핵심 원칙]\n${soulContent}\n`;
    }

    // 2. USER.md - 사용자 정보 (전체 로드)
    const userPath = path.join(openclawDir, "USER.md");
    if (fs.existsSync(userPath)) {
      const userContent = fs.readFileSync(userPath, "utf-8");
      context += `\n[USER.md - 사용자 정보]\n${userContent}\n`;
    }

    // 3. 오늘의 메모리 (최근 내용 중심)
    const today = new Date().toISOString().slice(0, 10);
    const memoryPath = path.join(openclawDir, "memory", `${today}.md`);
    if (fs.existsSync(memoryPath)) {
      const memoryContent = fs.readFileSync(memoryPath, "utf-8");
      // 최근 2000자만 로드 (너무 길면 컨텍스트 낭비)
      const recentMemory = memoryContent.slice(-2000);
      context += `\n[오늘의 기억 - ${today}]\n${recentMemory}\n`;
    }

    // 4. 어제 메모리도 참조 (연속성)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayPath = path.join(openclawDir, "memory", `${yesterday}.md`);
    if (fs.existsSync(yesterdayPath)) {
      const yesterdayContent = fs.readFileSync(yesterdayPath, "utf-8");
      // 어제 내용은 요약만 (500자)
      const summary = yesterdayContent.slice(0, 500);
      context += `\n[어제 기억 요약 - ${yesterday}]\n${summary}...\n`;
    }

    // 5. 그래프 스키마
    const graphSchema = await this.contextCache.getGraphSchema(this.graphDB);
    context += `\n${graphSchema}`;

    return context;
  }

  // 대화 내용을 오늘의 메모리에 저장
  async saveToMemory(content: string, category: string = "대화"): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const memoryPath = path.join(this.vaultPath, ".openclaw", "memory", `${today}.md`);

    let existing = "";
    if (fs.existsSync(memoryPath)) {
      existing = fs.readFileSync(memoryPath, "utf-8");
    } else {
      existing = `# ${today} 메모리\n\n`;
    }

    const entry = `\n## ${category} [${time}]\n${content}\n`;
    fs.writeFileSync(memoryPath, existing + entry, "utf-8");
  }

  invalidateCache() {
    this.contextCache.invalidate();
  }

  async determineRoute(message: string): Promise<Provider> {
    if (!this.openaiClient) return this.provider;

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: "Classify the user query into 'simple' or 'complex'.\n" +
                     "- 'simple': Greetings, weather, time, simple reminders, factual questions, or journaling ('기억해', '저장해').\n" +
                     "- 'complex': Deep analysis, coding, creative writing, complex reasoning over personal documents, or vague queries requiring multi-step thinking.\n" +
                     "Respond only with the word 'simple' or 'complex'." 
          },
          { role: "user", content: message }
        ],
        max_tokens: 10,
        temperature: 0
      });

      const decision = response.choices[0].message.content?.toLowerCase().trim();
      console.log(`[Router] Decision: ${decision} for message: "${message.slice(0, 30)}..."`);
      
      return decision === "complex" ? "claude" : "openai";
    } catch (err) {
      console.log("[Router] Error, defaulting to current provider:", err);
      return this.provider;
    }
  }
}