/**
 * Content Extraction — Rich Content from URLs
 *
 * When the agent discovers relevant URLs (via search, conversation, or memory),
 * this module extracts clean content for deeper understanding. Extracted content
 * is stored as episodic memories linked to the original search context.
 *
 * Supports both basic text extraction and advanced JS-rendered page extraction.
 */

import { saveMemory } from "../../src/agent/core/temporal/index.js";
import { loadSearchAgentConfig } from "./searchConfig.js";

export interface ExtractRequest {
    urls: string[];
    query?: string;          // Optional: reranks content by relevance to this query
    chunksPerSource?: number; // 1-5, requires query. Prevents context explosion.
    extractDepth?: "basic" | "advanced"; // advanced handles JS-rendered pages
    format?: "markdown" | "text";
}

export interface ExtractedContent {
    url: string;
    content: string;
    title?: string;
}

export interface ExtractResponse {
    success: boolean;
    results: ExtractedContent[];
    failed: string[];
    memoryIds: string[];
}

/**
 * Extract clean content from one or more URLs
 *
 * - Basic: Fast text extraction for static pages
 * - Advanced: Handles JavaScript-rendered pages (slower)
 * - Use `query` + `chunksPerSource` to get only relevant excerpts
 */
export async function extractContent(request: ExtractRequest): Promise<ExtractResponse> {
    const config = loadSearchAgentConfig();

    const apiKey = process.env.TAVILY_API_KEY || config.tavily_api_key;
    if (!apiKey) {
        throw new Error("TAVILY_API_KEY not set in environment or config");
    }

    if (request.urls.length === 0) {
        return { success: true, results: [], failed: [], memoryIds: [] };
    }

    if (request.urls.length > 20) {
        console.warn("[EXTRACT] Tavily supports max 20 URLs per request, truncating");
        request.urls = request.urls.slice(0, 20);
    }

    console.log(`[EXTRACT] Extracting ${request.urls.length} URL(s), depth: ${request.extractDepth || "basic"}`);

    const body: Record<string, any> = {
        urls: request.urls,
        extract_depth: request.extractDepth || "basic",
        format: request.format || "markdown",
    };

    if (request.query) {
        body.query = request.query;
        if (request.chunksPerSource) {
            body.chunks_per_source = Math.max(1, Math.min(5, request.chunksPerSource));
        }
    }

    const response = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Tavily Extract API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;

    const results: ExtractedContent[] = (data.results || []).map((r: any) => ({
        url: r.url,
        content: r.raw_content || r.content || "",
        title: r.title,
    }));

    const failed: string[] = (data.failed_results || []).map((r: any) => r.url || r);

    console.log(`[EXTRACT] Extracted ${results.length} pages, ${failed.length} failed`);

    // Store extracted content as episodic memories
    const memoryIds: string[] = [];
    if (config.save_to_memory) {
        for (const result of results) {
            // Truncate very long content to avoid memory bloat
            const content = result.content.length > 3000
                ? result.content.slice(0, 3000) + "\n\n[...truncated]"
                : result.content;

            try {
                const memoryId = await saveMemory({
                    content: `[Extracted: ${result.title || result.url}]\n\n${content}`,
                    type: "episodic",
                    importance: 0.6,
                    tags: ["extracted", "web_content", ...(request.query ? extractTopics(request.query) : [])],
                    source: "user_interaction",
                });
                memoryIds.push(memoryId);
            } catch (e) {
                console.warn(`[EXTRACT] Failed to save memory for ${result.url}:`, e);
            }
        }

        if (memoryIds.length > 0) {
            console.log(`[EXTRACT] Saved ${memoryIds.length} memories`);
        }
    }

    return {
        success: results.length > 0,
        results,
        failed,
        memoryIds,
    };
}

/**
 * Extract and summarize a single URL (convenience wrapper)
 */
export async function extractSingle(
    url: string,
    query?: string
): Promise<ExtractedContent | null> {
    const response = await extractContent({
        urls: [url],
        query,
        chunksPerSource: query ? 3 : undefined,
        format: "markdown",
    });

    return response.results[0] || null;
}

function extractTopics(query: string): string[] {
    const stopWords = new Set([
        "what", "is", "are", "the", "a", "an", "how", "why", "when", "where",
        "who", "which", "to", "in", "on", "for", "of", "and", "or", "about",
    ]);

    return query.toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
        .slice(0, 3);
}
