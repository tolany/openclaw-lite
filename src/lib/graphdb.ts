// OpenClaw Lite - GraphDB for GraphRAG
// Uses Neo4j + Obsidian links for knowledge graph

import neo4j, { Driver, Session } from "neo4j-driver";
import * as fs from "fs";
import * as path from "path";
import { logError } from "./logger";

export class GraphDB {
  private driver: Driver | null = null;
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  // Initialize Neo4j connection
  async init(uri: string, username: string, password: string): Promise<boolean> {
    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
      await this.driver.verifyConnectivity();
      console.log("[GraphDB] Connected to Neo4j");

      // Create indexes
      const session = this.driver.session();
      await session.run("CREATE INDEX doc_path IF NOT EXISTS FOR (d:Document) ON (d.path)");
      await session.run("CREATE INDEX doc_title IF NOT EXISTS FOR (d:Document) ON (d.title)");
      await session.close();

      return true;
    } catch (err: any) {
      logError("GraphDB.init", err);
      return false;
    }
  }

  // Parse Obsidian [[links]] from content
  private parseLinks(content: string): string[] {
    const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const links: string[] = [];
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      links.push(match[1].trim());
    }

    return [...new Set(links)]; // Remove duplicates
  }

  // Extract tags from content
  private parseTags(content: string): string[] {
    const tagRegex = /#([a-zA-Z가-힣][a-zA-Z0-9가-힣_-]*)/g;
    const tags: string[] = [];
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      tags.push(match[1]);
    }

    return [...new Set(tags)];
  }

  // Build graph from vault
  async buildGraph(progressCallback?: (current: number, total: number, file: string) => void): Promise<{
    nodes: number;
    relationships: number;
  }> {
    if (!this.driver) throw new Error("Not connected to Neo4j");

    const { glob } = await import("glob");
    const files = await glob("**/*.md", { cwd: this.vaultPath, nodir: true });

    const session = this.driver.session();
    let nodes = 0;
    let relationships = 0;

    try {
      // Clear existing data
      await session.run("MATCH (n) DETACH DELETE n");

      // First pass: Create all document nodes
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fullPath = path.join(this.vaultPath, file);
        const content = fs.readFileSync(fullPath, "utf-8");
        const title = path.basename(file, ".md");
        const tags = this.parseTags(content);
        const preview = content.substring(0, 200).replace(/\n/g, " ");

        await session.run(
          `CREATE (d:Document {
            path: $path,
            title: $title,
            preview: $preview,
            tags: $tags,
            folder: $folder
          })`,
          {
            path: file,
            title,
            preview,
            tags,
            folder: path.dirname(file)
          }
        );
        nodes++;

        // Create tag nodes and relationships
        for (const tag of tags) {
          await session.run(
            `MERGE (t:Tag {name: $tag})
             WITH t
             MATCH (d:Document {path: $path})
             MERGE (d)-[:HAS_TAG]->(t)`,
            { tag, path: file }
          );
        }

        if (progressCallback) {
          progressCallback(i + 1, files.length, file);
        }
      }

      // Second pass: Create LINKS_TO relationships
      for (const file of files) {
        const fullPath = path.join(this.vaultPath, file);
        const content = fs.readFileSync(fullPath, "utf-8");
        const links = this.parseLinks(content);

        for (const link of links) {
          // Find target document by title
          const result = await session.run(
            `MATCH (source:Document {path: $sourcePath})
             MATCH (target:Document) WHERE target.title = $linkTitle
             MERGE (source)-[r:LINKS_TO]->(target)
             RETURN count(r) as count`,
            { sourcePath: file, linkTitle: link }
          );

          if (result.records[0]?.get("count")?.toNumber() > 0) {
            relationships++;
          }
        }
      }

      return { nodes, relationships };
    } finally {
      await session.close();
    }
  }

  // GraphRAG search: Find related documents through graph traversal
  async graphSearch(query: string, depth: number = 2): Promise<{
    directMatches: Array<{ path: string; title: string; preview: string; score: number }>;
    relatedDocs: Array<{ path: string; title: string; relationship: string; hops: number }>;
  }> {
    if (!this.driver) throw new Error("Not connected to Neo4j");

    const session = this.driver.session();

    try {
      // Search documents by title or content match
      const directResult = await session.run(
        `MATCH (d:Document)
         WHERE d.title CONTAINS $query OR d.preview CONTAINS $query
         RETURN d.path as path, d.title as title, d.preview as preview
         LIMIT 5`,
        { query }
      );

      const directMatches = directResult.records.map((r, i) => ({
        path: r.get("path"),
        title: r.get("title"),
        preview: r.get("preview"),
        score: 1 - (i * 0.1)
      }));

      // Find related documents through graph traversal
      const relatedResult = await session.run(
        `MATCH (d:Document)
         WHERE d.title CONTAINS $query OR d.preview CONTAINS $query
         WITH d
         MATCH path = (d)-[r:LINKS_TO|HAS_TAG*1..${depth}]-(related:Document)
         WHERE related <> d
         WITH related,
              min(length(path)) as hops,
              [rel in relationships(path) | type(rel)] as relTypes
         RETURN DISTINCT related.path as path,
                related.title as title,
                relTypes[0] as relationship,
                hops
         ORDER BY hops ASC
         LIMIT 10`,
        { query }
      );

      const relatedDocs = relatedResult.records.map(r => ({
        path: r.get("path"),
        title: r.get("title"),
        relationship: r.get("relationship"),
        hops: r.get("hops").toNumber()
      }));

      return { directMatches, relatedDocs };
    } finally {
      await session.close();
    }
  }

  // Find path between two documents
  async findPath(from: string, to: string): Promise<string[]> {
    if (!this.driver) throw new Error("Not connected to Neo4j");

    const session = this.driver.session();

    try {
      const result = await session.run(
        `MATCH (a:Document), (b:Document)
         WHERE a.title CONTAINS $from AND b.title CONTAINS $to
         MATCH path = shortestPath((a)-[*]-(b))
         RETURN [node in nodes(path) | node.title] as titles`,
        { from, to }
      );

      if (result.records.length > 0) {
        return result.records[0].get("titles");
      }
      return [];
    } finally {
      await session.close();
    }
  }

  // Get document neighbors
  async getNeighbors(title: string): Promise<{
    linksTo: string[];
    linkedFrom: string[];
    sharedTags: Array<{ doc: string; tags: string[] }>;
  }> {
    if (!this.driver) throw new Error("Not connected to Neo4j");

    const session = this.driver.session();

    try {
      // Outgoing links
      const outgoing = await session.run(
        `MATCH (d:Document)-[:LINKS_TO]->(target:Document)
         WHERE d.title = $title
         RETURN target.title as title`,
        { title }
      );

      // Incoming links
      const incoming = await session.run(
        `MATCH (source:Document)-[:LINKS_TO]->(d:Document)
         WHERE d.title = $title
         RETURN source.title as title`,
        { title }
      );

      // Documents with shared tags
      const sharedTags = await session.run(
        `MATCH (d:Document)-[:HAS_TAG]->(t:Tag)<-[:HAS_TAG]-(other:Document)
         WHERE d.title = $title AND other <> d
         WITH other, collect(t.name) as tags
         RETURN other.title as doc, tags
         LIMIT 5`,
        { title }
      );

      return {
        linksTo: outgoing.records.map(r => r.get("title")),
        linkedFrom: incoming.records.map(r => r.get("title")),
        sharedTags: sharedTags.records.map(r => ({
          doc: r.get("doc"),
          tags: r.get("tags")
        }))
      };
    } finally {
      await session.close();
    }
  }

  // Get graph stats
  async getStats(): Promise<{ documents: number; relationships: number; tags: number }> {
    if (!this.driver) throw new Error("Not connected to Neo4j");

    const session = this.driver.session();

    try {
      const result = await session.run(`
        MATCH (d:Document) WITH count(d) as docs
        MATCH ()-[r:LINKS_TO]->() WITH docs, count(r) as rels
        MATCH (t:Tag) RETURN docs, rels, count(t) as tags
      `);

      const record = result.records[0];
      return {
        documents: record?.get("docs")?.toNumber() || 0,
        relationships: record?.get("rels")?.toNumber() || 0,
        tags: record?.get("tags")?.toNumber() || 0
      };
    } finally {
      await session.close();
    }
  }

  // Close connection
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }
}
