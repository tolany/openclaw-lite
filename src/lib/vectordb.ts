// OpenClaw Lite - Vector DB for Semantic Search
// Uses Gemini Embedding (free) + Vectra (local file-based)

import { GoogleGenerativeAI } from "@google/generative-ai";
import { LocalIndex } from "vectra";
import * as fs from "fs";
import * as path from "path";
import { logError } from "./logger";

const DATA_DIR = path.resolve(__dirname, "../../data/vectors");

export class VectorDB {
  private genAI: GoogleGenerativeAI;
  private index: LocalIndex | null = null;
  private vaultPath: string;

  constructor(apiKey: string, vaultPath: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.vaultPath = vaultPath;
  }

  // Initialize or load existing index
  async init(): Promise<void> {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.index = new LocalIndex(DATA_DIR);

    if (!await this.index.isIndexCreated()) {
      await this.index.createIndex();
      console.log("[VectorDB] New index created");
    } else {
      console.log("[VectorDB] Loaded existing index");
    }
  }

  // Get embedding for text using Gemini
  private async getEmbedding(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }

  // Index a single document
  async indexDocument(filePath: string, content: string): Promise<boolean> {
    if (!this.index) await this.init();

    try {
      // Truncate content to ~8000 chars for embedding
      const truncated = content.substring(0, 8000);
      const vector = await this.getEmbedding(truncated);

      // Create unique ID from file path
      const id = Buffer.from(filePath).toString("base64");

      await this.index!.insertItem({
        id,
        vector,
        metadata: {
          filePath,
          title: path.basename(filePath),
          indexed: new Date().toISOString(),
          preview: content.substring(0, 200)
        }
      });

      return true;
    } catch (err: any) {
      logError("VectorDB.indexDocument", err);
      return false;
    }
  }

  // Index all markdown files in vault
  async indexVault(progressCallback?: (current: number, total: number) => void): Promise<{ indexed: number; failed: number }> {
    if (!this.index) await this.init();

    const { glob } = await import("glob");
    const files = await glob("**/*.md", { cwd: this.vaultPath, nodir: true });

    let indexed = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fullPath = path.join(this.vaultPath, file);

      try {
        const content = fs.readFileSync(fullPath, "utf-8");

        // Skip very short files
        if (content.length < 100) continue;

        const success = await this.indexDocument(file, content);
        if (success) indexed++;
        else failed++;

        if (progressCallback) {
          progressCallback(i + 1, files.length);
        }

        // Rate limit: ~10 req/sec to stay under 1500/min
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        failed++;
      }
    }

    return { indexed, failed };
  }

  // Semantic search
  async search(query: string, topK: number = 5): Promise<{
    results: Array<{
      filePath: string;
      title: string;
      score: number;
      preview: string;
    }>;
  }> {
    if (!this.index) await this.init();

    try {
      const queryVector = await this.getEmbedding(query);
      // vectra queryItems: (vector, queryText, topK, filter?, isBm25?)
      const results = await this.index!.queryItems(queryVector, query, topK);

      return {
        results: results.map(r => ({
          filePath: r.item.metadata.filePath as string,
          title: r.item.metadata.title as string,
          score: r.score,
          preview: r.item.metadata.preview as string
        }))
      };
    } catch (err: any) {
      logError("VectorDB.search", err);
      return { results: [] };
    }
  }

  // Get index stats
  async getStats(): Promise<{ count: number; lastIndexed?: string }> {
    if (!this.index) await this.init();

    try {
      // Query with dummy to check if index has items
      const dummyVector = new Array(768).fill(0);
      const results = await this.index!.queryItems(dummyVector, "", 1);
      const lastItem = results.length > 0 ? results[0].item : null;

      return {
        count: results.length > 0 ? -1 : 0, // -1 means "has items"
        lastIndexed: lastItem?.metadata?.indexed as string | undefined
      };
    } catch {
      return { count: 0 };
    }
  }

  // Delete all and rebuild
  async rebuild(): Promise<void> {
    if (fs.existsSync(DATA_DIR)) {
      fs.rmSync(DATA_DIR, { recursive: true });
    }
    await this.init();
  }
}
