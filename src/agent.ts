import { GoogleGenerativeAI, Tool, SchemaType } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

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
          description: "Read vault file.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: { filePath: { type: SchemaType.STRING } },
            required: ["filePath"]
          }
        },
        {
          name: "run_script",
          description: "Run automation script.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: { scriptName: { type: SchemaType.STRING } },
            required: ["scriptName"]
          }
        }
      ]
    }];
  }

  private async getModel(modelName: string) {
    return this.genAI.getGenerativeModel({
      model: modelName,
      tools: this.tools
    });
  }

  private async handleToolCall(call: any): Promise<any> {
    const { name, args } = call;
    try {
      if (name === "read_file") {
        const fullPath = path.join(this.vaultPath, args.filePath);
        if (fs.existsSync(fullPath)) return { content: fs.readFileSync(fullPath, "utf-8") };
        return { error: "File not found" };
      }
      if (name === "run_script") {
        if (args.scriptName !== "run_scraper.sh") return { error: "Unauthorized" };
        const scriptPath = path.join(this.projectRoot, "scripts", args.scriptName);
        exec(`bash ${scriptPath} &`); 
        return { message: "Script started in background." };
      }
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async chat(message: string, history: any[] = []): Promise<string> {
    const bootstrap = await this.getBootstrapContext();
    const instructions = this.persona.instructions.map((i: string) => `- ${i}`).join("\n");
    const systemPrompt = `You are '${this.persona.name}'. Role: ${this.persona.role}. Language: ${this.persona.language}\n[Inst]\n${instructions}\n[Context]\n${bootstrap}`;

    const geminiHistory = history.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // v10: Flash 중심 고효율 라인업 (Pro 모델 제외)
    const modelsToTry = [
      "gemini-3-flash-preview", 
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ];
    
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        const model = await this.getModel(modelName);
        const chatSession = model.startChat({ history: geminiHistory });
        const fullMessage = `${systemPrompt}\n\nUser: ${message}`;
        
        let result = await chatSession.sendMessage(fullMessage);
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
        return response.text();
      } catch (err: any) {
        console.warn(`⚠️ Model ${modelName} failed:`, err.message);
        lastError = err;
        continue;
      }
    }

    return `❌ All models failed. Quota exceeded or service down.\nError: ${lastError?.message}`;
  }

  private async getBootstrapContext(): Promise<string> {
    const filesToLoad = ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md"];
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
