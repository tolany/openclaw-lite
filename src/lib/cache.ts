// OpenClaw Lite - Context Caching System
// Reduces token cost by caching system prompts and graph schema

import * as fs from "fs";
import * as path from "path";
import { GraphDB } from "./graphdb";

export interface CachedSchema {
  documents: number;
  relationships: number;
  tags: string[];
  topFolders: string[];
  recentDocs: string[];
  updatedAt: Date;
}

export class ContextCache {
  private schemaCache: CachedSchema | null = null;
  private schemaCacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private lastSchemaUpdate: number = 0;
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  // Get cached schema or build new one
  async getGraphSchema(graphDB: GraphDB): Promise<string> {
    const now = Date.now();

    if (this.schemaCache && (now - this.lastSchemaUpdate) < this.schemaCacheExpiry) {
      return this.formatSchema(this.schemaCache);
    }

    try {
      const stats = await graphDB.getStats();
      const tags = await this.getTopTags(graphDB);
      const folders = this.getTopFolders();
      const recentDocs = this.getRecentDocs(10);

      this.schemaCache = {
        documents: stats.documents,
        relationships: stats.relationships,
        tags,
        topFolders: folders,
        recentDocs,
        updatedAt: new Date()
      };
      this.lastSchemaUpdate = now;

      console.log(`[Cache] Schema updated: ${stats.documents} docs, ${stats.relationships} rels`);
      return this.formatSchema(this.schemaCache);
    } catch (err) {
      // Fallback to basic schema if GraphDB not available
      return this.getBasicSchema();
    }
  }

  private formatSchema(schema: CachedSchema): string {
    return `[Graph Schema]
- Documents: ${schema.documents}
- Relationships: ${schema.relationships}
- Top Tags: ${schema.tags.slice(0, 10).join(", ")}
- Folders: ${schema.topFolders.slice(0, 8).join(", ")}
- Recent: ${schema.recentDocs.slice(0, 5).join(", ")}

Use graph_search for relationship queries, semantic_search for meaning-based queries.`;
  }

  private getBasicSchema(): string {
    const folders = this.getTopFolders();
    return `[Vault Structure]
- Folders: ${folders.join(", ")}
- Use search_files or search_content to find documents.`;
  }

  private async getTopTags(graphDB: GraphDB): Promise<string[]> {
    try {
      // Query top tags from Neo4j
      const session = (graphDB as any).driver?.session();
      if (!session) return [];

      const result = await session.run(`
        MATCH (t:Tag)<-[:HAS_TAG]-(d:Document)
        RETURN t.name as tag, count(d) as count
        ORDER BY count DESC
        LIMIT 15
      `);
      await session.close();

      return result.records.map((r: any) => r.get("tag"));
    } catch {
      return [];
    }
  }

  private getTopFolders(): string[] {
    try {
      const entries = fs.readdirSync(this.vaultPath, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
        .map(e => e.name)
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  private getRecentDocs(limit: number): string[] {
    try {
      const files: { name: string; mtime: number }[] = [];
      this.walkDir(this.vaultPath, files, 3); // max depth 3

      return files
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit)
        .map(f => f.name);
    } catch {
      return [];
    }
  }

  private walkDir(dir: string, files: { name: string; mtime: number }[], maxDepth: number, currentDepth: number = 0) {
    if (currentDepth >= maxDepth) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkDir(fullPath, files, maxDepth, currentDepth + 1);
        } else if (entry.name.endsWith(".md")) {
          const stat = fs.statSync(fullPath);
          files.push({ name: entry.name.replace(".md", ""), mtime: stat.mtimeMs });
        }
      }
    } catch {}
  }

  // Invalidate cache (call after /buildgraph)
  invalidate() {
    this.schemaCache = null;
    this.lastSchemaUpdate = 0;
    console.log("[Cache] Schema cache invalidated");
  }
}

// Claude Prompt Caching Helper
export function buildClaudeCachedSystem(basePrompt: string, schemaContext: string): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  return [
    {
      type: "text" as const,
      text: basePrompt,
      cache_control: { type: "ephemeral" as const }
    },
    {
      type: "text" as const,
      text: schemaContext,
      cache_control: { type: "ephemeral" as const }
    }
  ];
}
