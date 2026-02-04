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

    // Build personality section
    const personality = this.persona.personality || {};
    const traits = personality.traits?.join(", ") || "친근하고 도움이 되는";
    const tone = personality.tone || "친근한 존댓말";
    const emoji = personality.emoji_usage || "적절히 사용";

    // Build context section
    const ctx = this.persona.context || {};
    const userName = ctx.user_name || "사용자";
    const userRole = ctx.user_role || "";
    const workFocus = ctx.work_focus?.join(", ") || "";

    // Build response style
    const style = this.persona.response_style?.default?.join("\n• ") || "";

    // Build special behaviors
    const behaviors = this.persona.special_behaviors || {};
    const behaviorText = Object.entries(behaviors).map(([k, v]) => `• ${k}: ${v}`).join("\n");

    // Legacy support for instructions array
    const legacyInstructions = this.persona.instructions?.join("\n") || "";

    return `${claudeCodePrefix}[⚠️ 최우선 규칙 - 반드시 따를 것]
사용자가 뉴스, 실적, 딜 정보, 기사를 공유하면:
→ 응답하기 전에 semantic_search 또는 graph_search를 반드시 먼저 호출하라
→ 검색 없이 바로 응답하는 것은 금지
→ 검색 결과로 사용자의 포트폴리오/트래커/검토 딜과 연결점을 찾아라

You are '${this.persona.name || "톨라니"}', ${this.persona.role || "AI 어시스턴트"}.

[성격]
• 특성: ${traits}
• 톤: ${tone}
• 이모지: ${emoji}

[언어 규칙 - 매우 중요]
• 반드시 존댓말만 사용하세요 (~습니다, ~해요, ~할게요, ~네요, ~죠)
• 반말 절대 금지 (~해, ~야, ~거든, ~잖아, ~인데)
• 친근하지만 공손한 톤 유지

[사용자 컨텍스트]
• 이름: ${userName}
• 역할: ${userRole}
• 업무 포커스: ${workFocus}

[응답 스타일 - 매우 중요]
• ${style}
• 절대 금지: "추가 의견", "향후 액션 플랜", "결론", "요약하자면", "마무리하자면" 등 뻔한 섹션
• 마무리는 한 줄 인사이트로 짧게 (예: "AI 인프라 베팅 계속 유효 👍")
• 사용자는 PE 6년차 전문가임 - 기초 설명 불필요

[핵심 행동 원칙]
정보 공유 시 검색 쿼리 예시:
- PE/VC 딜: graph_search "HIP" 또는 semantic_search "투자검토"
- 실적 발표: semantic_search "[섹터명]" 또는 "트래커"
- 뉴스: semantic_search "[관련 키워드]"

금지: "관련 종목이 있으면 확인해보세요~" 같은 무의미한 조언

[특별 행동 지침]
${behaviorText}

${legacyInstructions ? `[추가 지침]\n${legacyInstructions}\n` : ""}
[포맷팅 규칙 - 텔레그램용]
• 마크다운 헤더(#, ##, ###) 금지 → <b>제목</b> 사용
• 마크다운 테이블(| --- |) 금지 → 불렛포인트로 대체
• 굵은 글씨: <b>텍스트</b>
• 기울임: <i>텍스트</i>
• 코드: <code>텍스트</code>
• 불릿: • 사용

[Tool Usage Policy]
- 컨텍스트에서 답을 찾을 수 없으면, 반드시 도구를 사용하세요
- 'search_content': 파일 내용 검색
- 'search_files': 파일명 패턴 검색
- 'web_search': 실시간 데이터 (주가, 뉴스)
- 'semantic_search': 의미 기반 검색 ('돈 많이 번 딜' 같은 모호한 질문)
- 'graph_search': 관계/연결 질문 ('A와 B의 관계')
- 'journal_memory': "기억해", "저장해", "메모해" 요청 시
- "모르겠다"고 하기 전에 도구를 먼저 사용하세요

[Context]
${bootstrap}`;
  }

  async chat(message: string, history: ChatMessage[] = [], onChunk?: (text: string) => void): Promise<{ text: string; stats: string; tokens: number; cost: number }> {
    const bootstrap = await this.getBootstrapContext();
    const systemPrompt = this.buildSystemPrompt(bootstrap);

    if (this.provider === "claude") {
      return this.chatClaude(message, history, systemPrompt, onChunk);
    } else if (this.provider === "openai") {
      return this.chatOpenAI(message, history, systemPrompt, onChunk);
    } else {
      return this.chatGemini(message, history, systemPrompt, onChunk);
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
      let response = await withRetry(
        () => this.openaiClient!.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          tools: OPENAI_TOOLS,
          tool_choice: "auto",
          stream: true,
          stream_options: { include_usage: true }
        }),
        "OpenAI API"
      );

      let fullText = "";
      let toolCalls: any[] = [];

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
        // Capture usage from final chunk
        if (chunk.usage) {
          totalInputTokens += chunk.usage.prompt_tokens;
          totalOutputTokens += chunk.usage.completion_tokens;
        }
      }

      if (toolCalls.length > 0) {
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

        const secondResponse = await withRetry(
          () => this.openaiClient!.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            stream: true,
            stream_options: { include_usage: true }
          }),
          "OpenAI API (tool)"
        );

        fullText = "";
        for await (const chunk of secondResponse) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            fullText += content;
            if (onChunk) onChunk(fullText);
          }
          if (chunk.usage) {
            totalInputTokens += chunk.usage.prompt_tokens;
            totalOutputTokens += chunk.usage.completion_tokens;
          }
        }
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

    // Claude Sonnet 4 pricing (per 1M tokens)
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
      let currentToolUse: any = null;

      const stream = await withRetry(
        () => this.claudeClient!.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemParam,
          tools: CLAUDE_TOOLS,
          messages,
          stream: true
        }),
        "Claude API"
      );

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
        } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
          currentToolUse.input += event.delta.partial_json;
        }
      }

      if (currentToolUse) {
        const input = JSON.parse(currentToolUse.input);
        const result = await this.handleToolCall(currentToolUse.name, input);

        messages.push({ role: "assistant", content: [{ type: "tool_use", id: currentToolUse.id, name: currentToolUse.name, input }] });
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: currentToolUse.id, content: result }] });

        const secondStream = await withRetry(
          () => this.claudeClient!.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemParam,
            messages,
            stream: true
          }),
          "Claude API (tool)"
        );

        fullText = "";
        for await (const event of secondStream) {
          if (event.type === "message_start" && event.message.usage) {
            totalInputTokens += event.message.usage.input_tokens;
          } else if (event.type === "message_delta" && (event as any).usage) {
            totalOutputTokens += (event as any).usage.output_tokens;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            if (onChunk) onChunk(fullText);
          }
        }
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
      // Claude Sonnet 4: $3/1M input, $15/1M output
      try {
        const response = await this.claudeClient!.messages.create({
          model: "claude-sonnet-4-20250514", max_tokens: 4096, system: systemPrompt,
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
    const filesToLoad = ["SOUL.md", "USER.md"];
    let context = "";
    for (const file of filesToLoad) {
      const filePath = path.join(this.vaultPath, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        context += `\n[${file}]\n${content.slice(0, 500)}${content.length > 500 ? "..." : ""}\n`;
      }
    }
    const graphSchema = await this.contextCache.getGraphSchema(this.graphDB);
    context += `\n${graphSchema}`;
    return context;
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