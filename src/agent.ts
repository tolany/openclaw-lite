// OpenClaw Lite - Main Agent (v2.0)

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { LibrarianTools, JournalistTools, WebTools, getToolDeclarations } from "./tools";
import { logTool, logChat, logError } from "./lib/logger";
import { ChatMessage } from "./types";

export class OpenClawAgent {
  private genAI: GoogleGenerativeAI;
  private vaultPath: string;
  private persona: any;
  private projectRoot: string;
  private tools;

  // Tool instances
  private librarian: LibrarianTools;
  private journalist: JournalistTools;
  private web: WebTools;

  constructor(apiKey: string, vaultPath: string, personaPath: string, braveApiKey?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.vaultPath = vaultPath;
    this.projectRoot = path.dirname(personaPath);

    try {
      this.persona = JSON.parse(fs.readFileSync(personaPath, "utf-8"));
    } catch (e) {
      this.persona = { name: "Assistant", role: "Helpful Assistant", instructions: [] };
    }

    this.tools = getToolDeclarations();
    this.librarian = new LibrarianTools(vaultPath);
    this.journalist = new JournalistTools(vaultPath);
    this.web = new WebTools(braveApiKey);
  }

  private async getModel(modelName: string) {
    return this.genAI.getGenerativeModel({ model: modelName, tools: this.tools });
  }

  private async handleToolCall(call: any): Promise<any> {
    const { name, args } = call;
    let result: any;

    try {
      switch (name) {
        // Librarian tools
        case "read_file":
          result = this.librarian.readFile(args.filePath);
          break;
        case "search_files":
          result = await this.librarian.searchFiles(args.pattern);
          break;
        case "search_content":
          result = this.librarian.searchContent(args.query, args.fileType);
          break;

        // Journalist tools
        case "journal_memory":
          result = this.journalist.journalMemory(args.content, args.category);
          break;
        case "write_file":
          result = this.journalist.writeFile(args.filePath, args.content, args.mode);
          break;

        // Web tools
        case "web_search":
          result = await this.web.webSearch(args.query, args.count);
          break;

        // Script runner
        case "run_script":
          const allowed = ["run_scraper.sh", "run_tracker.sh"];
          if (!allowed.includes(args.scriptName)) {
            result = { error: "Unauthorized script" };
          } else {
            exec(`bash ${path.join(this.projectRoot, args.scriptName)} &`);
            result = { message: "Script started" };
          }
          break;

        default:
          result = { error: `Unknown tool: ${name}` };
      }
    } catch (err: any) {
      result = { error: err.message };
      logError(`Tool ${name}`, err);
    }

    logTool(name, args, result);
    return result;
  }

  private calculateCost(promptTokens: number, candidatesTokens: number): string {
    const inputPrice = (promptTokens / 1000000) * 0.5 * 1400;
    const outputPrice = (candidatesTokens / 1000000) * 3.0 * 1400;
    return (inputPrice + outputPrice).toFixed(1);
  }

  private buildSystemPrompt(bootstrap: string): string {
    return `You are '${this.persona.name}'.
[Instructions]
${this.persona.instructions.join("\n")}
[Tool Usage Policy]
- If you cannot find the answer in context, YOU MUST USE tools first.
- Use 'search_content' to find text inside files.
- Use 'search_files' to find files by name pattern.
- Use 'web_search' for real-time data (stock prices, news, etc.).
- Use 'journal_memory' when user says "기억해", "저장해", "메모해".
- Do NOT say "I don't know" without using tools.
- Use HTML tags (<b>, <i>, <code>) for formatting.

[Context]
${bootstrap}`;
  }

  async chat(message: string, history: ChatMessage[] = []): Promise<{ text: string; stats: string; tokens: number; cost: number }> {
    const bootstrap = await this.getBootstrapContext();
    const systemPrompt = this.buildSystemPrompt(bootstrap);

    const geminiHistory = history.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    const modelsToTry = ["gemini-2.5-flash-preview-05-20", "gemini-2.0-flash"];
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      for (let retry = 0; retry < 2; retry++) {
        try {
          const model = await this.getModel(modelName);
          const chatSession = model.startChat({ history: geminiHistory });

          let result = await chatSession.sendMessage(`${systemPrompt}\n\nUser: ${message}`);
          let response = await result.response;

          let parts = response.candidates?.[0]?.content?.parts || [];
          let calls = parts.filter((p: any) => p.functionCall);

          // Tool call loop
          while (calls.length > 0) {
            const toolResponses = await Promise.all(
              calls.map(async (call: any) => {
                const output = await this.handleToolCall(call.functionCall);
                return { functionResponse: { name: call.functionCall.name, response: output } };
              })
            );
            result = await chatSession.sendMessage(toolResponses);
            response = await result.response;
            parts = response.candidates?.[0]?.content?.parts || [];
            calls = parts.filter((p: any) => p.functionCall);
          }

          const usage = response.usageMetadata;
          const tokens = usage?.totalTokenCount || 0;
          const cost = usage ? parseFloat(this.calculateCost(usage.promptTokenCount, usage.candidatesTokenCount)) : 0;
          const stats = usage ? `[T: ${tokens} | ${cost}원]` : "";

          return { text: response.text(), stats, tokens, cost };

        } catch (err: any) {
          lastError = err;
          logError(`Model ${modelName}`, err);
          if (err.message.includes("429") || err.message.includes("404")) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    return { text: `All models failed.\nError: ${lastError?.message}`, stats: "", tokens: 0, cost: 0 };
  }

  // Vision: Chat with image
  async chatWithImage(message: string, imageBuffer: Buffer, mimeType: string): Promise<{ text: string; stats: string }> {
    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const bootstrap = await this.getBootstrapContext();

      const result = await model.generateContent([
        { text: `${this.buildSystemPrompt(bootstrap)}\n\nUser: ${message}` },
        { inlineData: { mimeType, data: imageBuffer.toString("base64") } }
      ]);

      const response = await result.response;
      const usage = response.usageMetadata;
      const stats = usage ? `[T: ${usage.totalTokenCount} | ${this.calculateCost(usage.promptTokenCount, usage.candidatesTokenCount)}원]` : "";

      return { text: response.text(), stats };
    } catch (err: any) {
      logError("Vision", err);
      return { text: `Vision error: ${err.message}`, stats: "" };
    }
  }

  private async getBootstrapContext(): Promise<string> {
    const filesToLoad = ["SOUL.md", "USER.md", "MEMORY.md"];
    let context = "";
    for (const file of filesToLoad) {
      const filePath = path.join(this.vaultPath, file);
      if (fs.existsSync(filePath)) {
        context += `\n[${file}]\n${fs.readFileSync(filePath, "utf-8")}\n`;
      }
    }
    return context;
  }
}
