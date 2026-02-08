/**
 * Search Tool — Web Search with Caching Layer
 *
 * Wraps the Tavily API client with in-memory caching and
 * config-driven behavior (depth, max results, TTL).
 */

import { searchViaTavily } from "./tavily.js";
import { loadSearchAgentConfig } from "./searchConfig.js";

export interface SearchResult {
    query: string;
    results: Array<{
        title: string;
        url: string;
        content: string;
        score: number;
    }>;
    summary: string;
    searched_at: string;
}

// In-memory cache for recent searches
const searchCache = new Map<string, { result: SearchResult; timestamp: number }>();

/**
 * Search the web using Tavily
 */
export async function searchWeb(
    query: string,
    options: {
        maxResults?: number;
        searchDepth?: "basic" | "advanced";
        useCache?: boolean;
    } = {}
): Promise<SearchResult> {
    const config = loadSearchAgentConfig();
    const CACHE_TTL_MS = config.cache_ttl_minutes * 60 * 1000;

    const {
        maxResults = config.max_results_per_search,
        searchDepth = config.search_depth,
        useCache = config.use_cache
    } = options;

    // Check cache first
    if (useCache) {
        const cached = searchCache.get(query);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            console.log(`[SEARCH] Cache hit for: "${query.slice(0, 50)}..."`);
            return cached.result;
        }
    }

    // Check for API key
    const apiKey = process.env.TAVILY_API_KEY || config.tavily_api_key;
    if (!apiKey) {
        throw new Error("TAVILY_API_KEY not set in environment or config");
    }

    // Ensure env var is set for the Tavily client
    if (!process.env.TAVILY_API_KEY) {
        process.env.TAVILY_API_KEY = apiKey;
    }

    console.log(`[SEARCH] Querying Tavily: "${query.slice(0, 50)}..."`);

    const tavilyResponse = await searchViaTavily(query, {
        maxResults,
        searchDepth,
        includeAnswer: true,
    });

    const searchResult: SearchResult = {
        query,
        results: tavilyResponse.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
        })),
        summary: synthesizeSummary(tavilyResponse.results),
        searched_at: new Date().toISOString(),
    };

    // Cache the result
    if (useCache) {
        searchCache.set(query, { result: searchResult, timestamp: Date.now() });
    }

    console.log(`[SEARCH] Found ${searchResult.results.length} results`);
    return searchResult;
}

function synthesizeSummary(results: any[]): string {
    if (results.length === 0) return "No results found.";

    return results
        .slice(0, 3)
        .map(r => r.content || "")
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 1500);
}

export function clearSearchCache(): void {
    searchCache.clear();
    console.log("[SEARCH] Cache cleared");
}

export function getSearchCacheStats(): { size: number; queries: string[] } {
    return {
        size: searchCache.size,
        queries: Array.from(searchCache.keys()),
    };
}
