import { GoogleGenerativeAI, Tool, SchemaType } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";

export class OpenClawAgent {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private vaultPath: string;
  private persona: any;

  constructor(apiKey: string, vaultPath: string, personaPath: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.vaultPath = vaultPath;
    
    // Load persona
    try {
      this.persona = JSON.parse(fs.readFileSync(personaPath, "utf-8"));
    } catch (e) {
      console.warn("⚠️ Failed to load persona.json, using default.");
      this.persona = { name: "Assistant", role: "Helpful Assistant", instructions: [] };
    }

    const tools: Tool[] = [{
      functionDeclarations: [
        {
          name: "read_file",
          description: "Read the content of a file from the vault.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              filePath: { type: SchemaType.STRING, description: "Relative path to file" }
            },
            required: ["filePath"]
          }
        },
        {
          name: "list_files",
          description: "List files in a directory.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              dirPath: { type: SchemaType.STRING, description: "Relative directory path" }
            },
            required: ["dirPath"]
          }
        }
      ]
    }];

    this.model = this.genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      tools: tools
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
      if (name === "list_files") {
        const fullPath = path.join(this.vaultPath, args.dirPath);
        if (fs.existsSync(fullPath)) return { files: fs.readdirSync(fullPath) };
        return { error: "Directory not found" };
      }
    } catch (err: any) {
      return { error: err.message };
    }
  }

  private async getBootstrapContext(): Promise<string> {
    // 특정 파일명도 설정에서 뺄 수 있지만, 일단 핵심 파일명은 컨벤션으로 유지
    const filesToLoad = ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md"];
    let context = "\n=== CORE CONTEXT ===\n";
    for (const file of filesToLoad) {
      const filePath = path.join(this.vaultPath, file);
      if (fs.existsSync(filePath)) {
        context += `\n[File: ${file}]\n${fs.readFileSync(filePath, "utf-8")}\n`;
      }
    }
    return context;
  }

  async chat(message: string, history: any[] = []): Promise<string> {
    const bootstrap = await this.getBootstrapContext();
    const instructions = this.persona.instructions.map((i: string) => `- ${i}`).join("\n");
    
    const systemPrompt = `You are '${this.persona.name}'.
    Role: ${this.persona.role}
    Language: ${this.persona.language}
    
    [Instructions]
    ${instructions}
    
    [Context from Vault]
    ${bootstrap}`;

    const geminiHistory = history.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const chatSession = this.model.startChat({ history: geminiHistory });
    const fullMessage = `${systemPrompt}\n\nUser Message: ${message}`;
    
    let result = await chatSession.sendMessage(fullMessage);
    let response = await result.response;
    
    let calls = response.candidates[0].content.parts.filter((p: any) => p.functionCall);
    
    while (calls.length > 0) {
      const toolResponses = await Promise.all(calls.map(async (call: any) => {
        const output = await this.handleToolCall(call.functionCall);
        return { functionResponse: { name: call.functionCall.name, response: output } };
      }));
      result = await chatSession.sendMessage(toolResponses);
      response = await result.response;
      calls = response.candidates[0].content.parts.filter((p: any) => p.functionCall);
    }

    return response.text();
  }
}
