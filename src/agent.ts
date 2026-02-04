// OpenClaw Lite - Main Agent (v3.0 - Multi-provider: Claude/Gemini)

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { LibrarianTools, JournalistTools, WebTools, getToolDeclarations } from "./tools";
import { logTool, logError } from "./lib/logger";
import { ChatMessage } from "./types";

// Anthropic tool schema
const CLAUDE_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read file content from vault",
    input_schema: { type: "object" as const, properties: { filePath: { type: "string" } }, required: ["filePath"] }
  },
  {
    name: "search_files",
    description: "Find files by pattern (e.g., '**/*keyword*.md')",
    input_schema: { type: "object" as const, properties: { pattern: { type: "string" } }, required: ["pattern"] }
  },
  {
    name: "search_content",
    description: "Search inside file contents",
    input_schema: { type: "object" as const, properties: { query: { type: "string" }, fileType: { type: "string" } }, required: ["query"] }
  },
  {
    name: "journal_memory",
    description: "Save to daily journal",
    input_schema: { type: "object" as const, properties: { content: { type: "string" }, category: { type: "string", enum: ["insight", "meeting", "todo", "idea"] } }, required: ["content", "category"] }
  },
  {
    name: "write_file",
    description: "Write or append to file",
    input_schema: { type: "object" as const, properties: { filePath: { type: "string" }, content: { type: "string" }, mode: { type: "string", enum: ["overwrite", "append"] } }, required: ["filePath", "content"] }
  },
  {
    name: "web_search",
    description: "Search web for real-time info",
    input_schema: { type: "object" as const, properties: { query: { type: "string" }, count: { type: "number" } }, required: ["query"] }
  },
  {
    name: "run_script",
    description: "Run automation scripts",
    input_schema: { type: "object" as const, properties: { scriptName: { type: "string" } }, required: ["scriptName"] }
  }
];

export type Provider = "claude" | "gemini";

export class OpenClawAgent {
  private provider: Provider;
  private claudeClient?: Anthropic;
  private geminiClient?: GoogleGenerativeAI;
  private vaultPath: string;
  private persona: any;
  private projectRoot: string;

  private librarian: LibrarianTools;
  private journalist: JournalistTools;
  private web: WebTools;

  constructor(
    provider: Provider,
    apiKey: string,
    vaultPath: string,
    personaPath: string,
    braveApiKey?: string
  ) {
    this.provider = provider;
    this.vaultPath = vaultPath;
    this.projectRoot = path.dirname(personaPath);

    if (provider === "claude") {
      this.claudeClient = new Anthropic({ apiKey });
    } else {
      this.geminiClient = new GoogleGenerativeAI(apiKey);
    }

    try {
      this.persona = JSON.parse(fs.readFileSync(personaPath, "utf-8"));
    } catch (e) {
      this.persona = { name: "Assistant", role: "Helpful Assistant", instructions: [] };
    }

    this.librarian = new LibrarianTools(vaultPath);
    this.journalist = new JournalistTools(vaultPath);
    this.web = new WebTools(braveApiKey);
  }

  private async handleToolCall(name: string, input: any): Promise<string> {
    let result: any;
    try {
      switch (name) {
        case "read_file": result = this.librarian.readFile(input.filePath); break;
        case "search_files": result = await this.librarian.searchFiles(input.pattern); break;
        case "search_content": result = this.librarian.searchContent(input.query, input.fileType); break;
        case "journal_memory": result = this.journalist.journalMemory(input.content, input.category); break;
        case "write_file": result = this.journalist.writeFile(input.filePath, input.content, input.mode); break;
        case "web_search": result = await this.web.webSearch(input.query, input.count); break;
        case "run_script":
          const allowed = ["run_scraper.sh", "run_tracker.sh"];
          if (!allowed.includes(input.scriptName)) result = { error: "Unauthorized" };
          else { exec(`bash ${path.join(this.projectRoot, input.scriptName)} &`); result = { message: "Started" }; }
          break;
        default: result = { error: `Unknown: ${name}` };
      }
    } catch (err: any) { result = { error: err.message }; logError(`Tool ${name}`, err); }
    logTool(name, input, result);
    return JSON.stringify(result);
  }

  private buildSystemPrompt(bootstrap: string): string {
    return `You are '${this.persona.name}'.
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

    try {
      let response = await this.claudeClient!.messages.create({
        model: "claude-sonnet-4-20250514", max_tokens: 4096, system: systemPrompt, tools: CLAUDE_TOOLS, messages
      });

      while (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUseBlocks.map(async (b) => ({ type: "tool_result" as const, tool_use_id: b.id, content: await this.handleToolCall(b.name, b.input) }))
        );
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });
        response = await this.claudeClient!.messages.create({
          model: "claude-sonnet-4-20250514", max_tokens: 4096, system: systemPrompt, tools: CLAUDE_TOOLS, messages
        });
      }

      const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text || "";
      const tokens = response.usage.input_tokens + response.usage.output_tokens;
      const cost = parseFloat(((response.usage.input_tokens / 1e6 * 3 + response.usage.output_tokens / 1e6 * 15) * 1400).toFixed(1));
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
      const model = this.geminiClient!.getGenerativeModel({ model: "gemini-3-flash-preview", tools });
      const chat = model.startChat({ history: geminiHistory });
      let result = await chat.sendMessage(`${systemPrompt}\n\nUser: ${message}`);
      let response = await result.response;

      let parts = response.candidates?.[0]?.content?.parts || [];
      let calls = parts.filter((p: any) => p.functionCall);

      while (calls.length > 0) {
        const toolResponses = await Promise.all(calls.map(async (c: any) => ({
          functionResponse: { name: c.functionCall.name, response: JSON.parse(await this.handleToolCall(c.functionCall.name, c.functionCall.args)) }
        })));
        result = await chat.sendMessage(toolResponses);
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
          model: "claude-sonnet-4-20250514", max_tokens: 4096, system: systemPrompt,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mimeType as any, data: imageBuffer.toString("base64") } },
            { type: "text", text: message }
          ]}]
        });
        const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text || "";
        const tokens = response.usage.input_tokens + response.usage.output_tokens;
        const cost = ((response.usage.input_tokens / 1e6 * 3 + response.usage.output_tokens / 1e6 * 15) * 1400).toFixed(1);
        return { text, stats: `[Claude|T:${tokens}|${cost}원]` };
      } catch (err: any) { return { text: `Error: ${err.message}`, stats: "" }; }
    } else {
      try {
        const model = this.geminiClient!.getGenerativeModel({ model: "gemini-3-flash-preview" });
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
    const filesToLoad = ["SOUL.md", "USER.md", "MEMORY.md"];
    let context = "";
    for (const file of filesToLoad) {
      const filePath = path.join(this.vaultPath, file);
      if (fs.existsSync(filePath)) context += `\n[${file}]\n${fs.readFileSync(filePath, "utf-8")}\n`;
    }
    return context;
  }
}
