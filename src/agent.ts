import { GoogleGenerativeAI, Tool, SchemaType } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { glob } from "glob";

export class OpenClawAgent {
  private genAI: GoogleGenerativeAI;
  private vaultPath: string;
  private persona: any;
  private projectRoot: string;
  private tools: Tool[];

  constructor(apiKey: string, vaultPath: string, personaPath: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.vaultPath = vaultPath;
    this.projectRoot = path.dirname(personaPath);
    
    try {
      this.persona = JSON.parse(fs.readFileSync(personaPath, "utf-8"));
    } catch (e) {
      this.persona = { name: "Assistant", role: "Helpful Assistant", instructions: [] };
    }

    this.tools = [{
      functionDeclarations: [
        {
          name: "read_file",
          description: "Read file content.",
          parameters: { type: SchemaType.OBJECT, properties: { filePath: { type: SchemaType.STRING } }, required: ["filePath"] }
        },
        {
          name: "search_files",
          description: "Find file paths using keyword (e.g., '**/*keyword*.md'). Use this whenever context is missing.",
          parameters: { 
            type: SchemaType.OBJECT, 
            properties: { pattern: { type: SchemaType.STRING } }, 
            required: ["pattern"] 
          }
        },
        {
          name: "run_script",
          description: "Run automation.",
          parameters: { type: SchemaType.OBJECT, properties: { scriptName: { type: SchemaType.STRING } }, required: ["scriptName"] }
        }
      ]
    }];
  }

  private async getModel(modelName: string) {
    return this.genAI.getGenerativeModel({ model: modelName, tools: this.tools });
  }

  private async handleToolCall(call: any): Promise<any> {
    const { name, args } = call;
    try {
      if (name === "read_file") {
        const fullPath = path.join(this.vaultPath, args.filePath);
        if (fs.existsSync(fullPath)) return { content: fs.readFileSync(fullPath, "utf-8") };
        return { error: "File not found" };
      }
      if (name === "search_files") {
        const files = await glob(args.pattern, { cwd: this.vaultPath, nodir: true });
        return { count: files.length, files: files.slice(0, 10) };
      }
      if (name === "run_script") {
        const allowed = ["run_scraper.sh", "run_tracker.sh"];
        if (!allowed.includes(args.scriptName)) return { error: "Unauthorized" };
        const scriptPath = path.join(this.projectRoot, "scripts", args.scriptName);
        exec(`bash ${scriptPath} &`); 
        return { message: "Script started." };
      }
    } catch (err: any) { return { error: err.message }; }
  }

  private calculateCost(promptTokens: number, candidatesTokens: number): string {
    const inputPrice = (promptTokens / 1000000) * 0.5 * 1400;
    const outputPrice = (candidatesTokens / 1000000) * 3.0 * 1400;
    return (inputPrice + outputPrice).toFixed(1);
  }

  async chat(message: string, history: any[] = []): Promise<{ text: string, stats: string }> {
    const bootstrap = await this.getBootstrapContext();
    // 프롬프트에 '검색 강제' 지시 추가
    const systemPrompt = `You are '${this.persona.name}'. 
    [Instructions]
    ${this.persona.instructions.join("\n")}    
    [Tool Usage Policy]
    - If you cannot find the answer in the context, YOU MUST USE 'search_files' tool first.
    - Do NOT say "I don't know" or "Information not found" without using tools.
    - Use HTML tags (<b>, <i>, <code>).
    
    [Context]
    ${bootstrap}`;

    const geminiHistory = history.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const modelsToTry = ["gemini-3-flash-preview", "gemini-2.5-flash"];
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

          while (calls.length > 0) {
            const toolResponses = await Promise.all(calls.map(async (call: any) => {
              const output = await this.handleToolCall(call.functionCall);
              return { functionResponse: { name: call.functionCall.name, response: output } };
            }));
            result = await chatSession.sendMessage(toolResponses);
            response = await result.response;
            parts = response.candidates?.[0]?.content?.parts || [];
            calls = parts.filter((p: any) => p.functionCall);
          }

          const usage = response.usageMetadata;
          const stats = usage ? `[T: ${usage.totalTokenCount} | ${this.calculateCost(usage.promptTokenCount, usage.candidatesTokenCount)}원]` : "";
          return { text: response.text(), stats };

        } catch (err: any) {
          lastError = err;
          if (err.message.includes("429") || err.message.includes("404")) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    return { text: `❌ All models failed.\nLast Error: ${lastError?.message}`, stats: "" };
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
