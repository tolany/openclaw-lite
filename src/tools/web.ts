// OpenClaw Lite - Web Tools
// web_search (Brave Search API)

import { ToolResult, WebSearchResult } from "../types";

export class WebTools {
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  // Search web using Brave Search API
  async webSearch(query: string, count: number = 5): Promise<ToolResult> {
    if (!this.apiKey) {
      return { error: "BRAVE_API_KEY not configured" };
    }

    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": this.apiKey
        }
      });

      if (!response.ok) {
        return { error: `Brave API error: ${response.status}` };
      }

      const data = await response.json();
      const results: WebSearchResult[] = (data.web?.results || []).slice(0, count).map((r: any) => ({
        title: r.title,
        url: r.url,
        description: r.description?.substring(0, 150) || ""
      }));

      return { count: results.length, results: results as any };
    } catch (err: any) {
      return { error: err.message };
    }
  }
}
