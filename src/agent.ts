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
            properties: { 
              scriptName: { 
                type: SchemaType.STRING,
                description: "Scripts: 'run_scraper.sh' (FnGuide), 'run_tracker.sh' (Stock Prices)"
              } 
            },
            required: ["scriptName"]
          }
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
      if (name === "run_script") {
        const allowed = ["run_scraper.sh", "run_tracker.sh"];
        if (!allowed.includes(args.scriptName)) return { error: "Unauthorized script" };
        const scriptPath = path.join(this.projectRoot, "scripts", args.scriptName);
        exec(`bash ${scriptPath} &`); 
        return { message: `${args.scriptName} started in background.` };
      }
    } catch (err: any) {
      return { error: err.message };
    }
  }

  async chat(message: string, history: any[] = []): Promise<string> {
    const bootstrap = await this.getBootstrapContext();
    const instructions = this.persona.instructions.map((i: string) => `- ${i}`).join("\n");
    
    // HTML 모드 지침 추가
    const systemPrompt = `You are '${this.persona.name}'. Role: ${this.persona.role}. Language: ${this.persona.language}
    [Formatting Rules]
    - Use **HTML tags** strictly compatible with Telegram.
    - Bold: <b>text</b> (Do not use **)
    - Italic: <i>text</i> (Do not use *)
    - Code: <code>text</code>
    - Link: <a href="url">text</a>
    - Do NOT use Markdown syntax (**, #, [ ]). Only HTML.
    
    [Instructions]
    ${instructions}
    [Context]
    ${bootstrap}`;

    const geminiHistory = history.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const targetModel = "gemini-3-flash-preview";
    const maxRetries = 3;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const model = await this.getModel(targetModel);
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
        if (i === maxRetries - 1) return `❌ Error: ${err.message}`;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    return "❌ System Error";
  }

  private async getBootstrapContext(): Promise<string> {
    const filesToLoad = ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md"];
    let context = "";
    for (const file of filesToLoad) {
      const filePath = path.join(this.vaultPath, file);
      if (fs.existsSync(filePath)) context += `\n[${file}]\n${fs.readFileSync(filePath, "utf-8")}\n`;
    }
    return context;
  }
}
