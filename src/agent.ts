// OpenClaw Lite - Main Agent (v4.1 - Streaming & Retry)

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
      const isRetryable = err.status === 429 || err.status === 500 || err.status === 503 || err.message?.includes("overloaded");

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

export type Provider = "claude" | "gemini";

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
  private apiKey: string;
  private claudeApiKey: string;
  private geminiApiKey: string;
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

    // Store both API keys for runtime switching
    this.claudeApiKey = process.env.ANTHROPIC_API_KEY || "";
    this.geminiApiKey = geminiApiKey || process.env.GOOGLE_API_KEY || "";

    // Initialize both clients if keys available
    if (this.claudeApiKey) {
      this.claudeClient = createAnthropicClient(this.claudeApiKey);
    }
    if (this.geminiApiKey) {
      this.geminiClient = new GoogleGenerativeAI(this.geminiApiKey);
    }

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
      if (!this.claudeApiKey) {
        return { success: false, message: "Claude API 키가 설정되지 않음 (ANTHROPIC_API_KEY)" };
      }
      if (!this.claudeClient) {
        this.claudeClient = createAnthropicClient(this.claudeApiKey);
      }
      this.provider = "claude";
      this.apiKey = this.claudeApiKey;
      console.log("[Agent] Switched to Claude");
      return { success: true, message: "Claude로 전환됨 ✓" };
    } else {
      if (!this.geminiApiKey) {
        return { success: false, message: "Gemini API 키가 설정되지 않음 (GOOGLE_API_KEY)" };
      }
      if (!this.geminiClient) {
        this.geminiClient = new GoogleGenerativeAI(this.geminiApiKey);
      }
      this.provider = "gemini";
      this.apiKey = this.geminiApiKey;
      console.log("[Agent] Switched to Gemini");
      return { success: true, message: "Gemini로 전환됨 ✓" };
    }
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

    return `${claudeCodePrefix}You are '${this.persona.name}'.
[Instructions]
${this.persona.instructions.join("\n")}
[Tool Usage Policy]
- If you cannot find the answer in context, YOU MUST USE tools first.
- Use 'search_content' to find text inside files.
- Use 'search_files' to find files by name pattern.
- Use 'web_search' for real-time data.
- Use 'journal_memory' when user says "기억해", "저장해", "메모해".
- Do NOT say "I don't know" without using tools.
- Use HTML tags (<b>, <i>, <code>) for formatting. Do NOT use markdown headers.

[Context]
${bootstrap}`;
  }

  async chat(message: string, history: ChatMessage[] = []): Promise<{ text: string; stats: string; tokens: number; cost: number }> {
    const bootstrap = await this.getBootstrapContext();
    const systemPrompt = this.buildSystemPrompt(bootstrap);

    if (this.provider === "claude") {
      return this.chatClaude(message, history, systemPrompt);
    } else {
      return this.chatGemini(message, history, systemPrompt);
    }
  }

  private async chatClaude(message: string, history: ChatMessage[], systemPrompt: string) {
    const messages: Anthropic.MessageParam[] = history.map(msg => ({
      role: msg.role as "user" | "assistant", content: msg.content
    }));
    messages.push({ role: "user", content: message });

    // Always use cached system prompt for cost reduction
    // cache_control: ephemeral caches for 5 minutes (90% cost reduction on cached tokens)
    const systemParam = isOAuthToken(this.apiKey)
      ? [
          { type: "text" as const, text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: "ephemeral" as const } },
          { type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }
        ]
      : buildClaudeCachedSystem(this.persona.instructions.join("\n"), systemPrompt);

    try {
      let response = await withRetry(
        () => this.claudeClient!.messages.create({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 4096,
          system: systemParam,
          tools: CLAUDE_TOOLS,
          messages
        }),
        "Claude API"
      );

      while (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUseBlocks.map(async (b) => ({ type: "tool_result" as const, tool_use_id: b.id, content: await this.handleToolCall(b.name, b.input) }))
        );
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
        response = await withRetry(
          () => this.claudeClient!.messages.create({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 4096,
            system: systemParam,
            tools: CLAUDE_TOOLS,
            messages
          }),
          "Claude API (tool)"
        );
      }

      const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text || "";
      const tokens = response.usage.input_tokens + response.usage.output_tokens;
      const cost = parseFloat(((response.usage.input_tokens / 1e6 * 0.25 + response.usage.output_tokens / 1e6 * 1.25) * 1400).toFixed(1));
      return { text, stats: `[Claude|T:${tokens}|${cost}원]`, tokens, cost };
    } catch (err: any) {
      logError("Claude", err);
      return { text: `Error: ${err.message}`, stats: "", tokens: 0, cost: 0 };
    }
  }

  private async chatGemini(message: string, history: ChatMessage[], systemPrompt: string) {
    const geminiHistory = history.map(msg => ({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] }));
    const tools = getToolDeclarations();

    try {
      const model = this.geminiClient!.getGenerativeModel({ model: "gemini-2.0-flash", tools });
      const chat = model.startChat({ history: geminiHistory });

      let result = await withRetry(
        () => chat.sendMessage(`${systemPrompt}\n\nUser: ${message}`),
        "Gemini API"
      );
      let response = await result.response;

      let parts = response.candidates?.[0]?.content?.parts || [];
      let calls = parts.filter((p: any) => p.functionCall);

      while (calls.length > 0) {
        const toolResponses = await Promise.all(calls.map(async (c: any) => ({
          functionResponse: { name: c.functionCall.name, response: JSON.parse(await this.handleToolCall(c.functionCall.name, c.functionCall.args)) }
        })));
        result = await withRetry(
          () => chat.sendMessage(toolResponses),
          "Gemini API (tool)"
        );
        response = await result.response;
        parts = response.candidates?.[0]?.content?.parts || [];
        calls = parts.filter((p: any) => p.functionCall);
      }

      const usage = response.usageMetadata;
      const tokens = usage?.totalTokenCount || 0;
      const cost = usage ? parseFloat(((usage.promptTokenCount / 1e6 * 0.5 + usage.candidatesTokenCount / 1e6 * 3) * 1400).toFixed(1)) : 0;
      return { text: response.text(), stats: `[Gemini|T:${tokens}|${cost}원]`, tokens, cost };
    } catch (err: any) {
      logError("Gemini", err);
      return { text: `Error: ${err.message}`, stats: "", tokens: 0, cost: 0 };
    }
  }

  async chatWithImage(message: string, imageBuffer: Buffer, mimeType: string): Promise<{ text: string; stats: string }> {
    const bootstrap = await this.getBootstrapContext();
    const systemPrompt = this.buildSystemPrompt(bootstrap);

    if (this.provider === "claude") {
      try {
        const response = await this.claudeClient!.messages.create({
          model: "claude-3-5-haiku-20241022", max_tokens: 4096, system: systemPrompt,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mimeType as any, data: imageBuffer.toString("base64") } },
            { type: "text", text: message }
          ]}]
        });
        const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text || "";
        const tokens = response.usage.input_tokens + response.usage.output_tokens;
        const cost = ((response.usage.input_tokens / 1e6 * 0.25 + response.usage.output_tokens / 1e6 * 1.25) * 1400).toFixed(1);
        return { text, stats: `[Claude|T:${tokens}|${cost}원]` };
      } catch (err: any) { return { text: `Error: ${err.message}`, stats: "" }; }
    } else {
      try {
        const model = this.geminiClient!.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent([
          { text: `${systemPrompt}\n\nUser: ${message}` },
          { inlineData: { mimeType, data: imageBuffer.toString("base64") } }
        ]);
        const response = await result.response;
        const usage = response.usageMetadata;
        const tokens = usage?.totalTokenCount || 0;
        const cost = usage ? ((usage.promptTokenCount / 1e6 * 0.5 + usage.candidatesTokenCount / 1e6 * 3) * 1400).toFixed(1) : "0";
        return { text: response.text(), stats: `[Gemini|T:${tokens}|${cost}원]` };
      } catch (err: any) { return { text: `Error: ${err.message}`, stats: "" }; }
    }
  }

  private async getBootstrapContext(): Promise<string> {
    // Load minimal context files (keep small for caching efficiency)
    const filesToLoad = ["SOUL.md", "USER.md"];
    let context = "";
    for (const file of filesToLoad) {
      const filePath = path.join(this.vaultPath, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        // Truncate large files to 500 chars
        context += `\n[${file}]\n${content.slice(0, 500)}${content.length > 500 ? "..." : ""}\n`;
      }
    }

    // Add cached graph schema
    const graphSchema = await this.contextCache.getGraphSchema(this.graphDB);
    context += `\n${graphSchema}`;

    return context;
  }

  // Invalidate cache (call after /buildgraph)
  invalidateCache() {
    this.contextCache.invalidate();
  }
}
