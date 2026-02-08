/**
 * Research Capability — Deep Knowledge Acquisition
 *
 * Uses Tavily's research endpoint to produce AI-synthesized reports
 * with citations. Results are stored as high-importance semantic memories,
 * making them available for future retrieval and consolidation.
 *
 * This is the agent's primary tool for building domain expertise over time.
 */

import { saveMemory } from "../../src/agent/core/temporal/index.js";
import { loadSearchAgentConfig } from "./searchConfig.js";

export interface ResearchRequest {
    topic: string;
    depth?: "quick" | "thorough";
    citation_format?: "numbered" | "mla" | "apa" | "chicago";
    output_schema?: Record<string, { type: string; description: string }>;
}

export interface ResearchResponse {
    success: boolean;
    report: string;
    sources: string[];
    memoryId?: string;
    model_used: string;
    duration_ms: number;
}

/**
 * Conduct deep research on a topic via Tavily Research API
 *
 * - "quick" uses the mini model (~30s)
 * - "thorough" uses the pro model (~60-120s, better for comparisons and comprehensive analysis)
 */
export async function conductResearch(request: ResearchRequest): Promise<ResearchResponse> {
    const startTime = Date.now();
    const config = loadSearchAgentConfig();

    const apiKey = process.env.TAVILY_API_KEY || config.tavily_api_key;
    if (!apiKey) {
        throw new Error("TAVILY_API_KEY not set in environment or config");
    }

    const model = request.depth === "thorough" ? "pro" : "mini";
    console.log(`[RESEARCH] Starting ${model} research: "${request.topic.slice(0, 60)}..."`);

    const body: Record<string, any> = {
        query: request.topic,
        model,
        citation_format: request.citation_format || "numbered",
    };

    if (request.output_schema) {
        body.output_schema = {
            type: "object",
            properties: request.output_schema,
        };
    }

    const response = await fetch("https://api.tavily.com/research", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Tavily Research API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;
    const durationMs = Date.now() - startTime;

    const report = data.report || data.content || "";
    const sources = extractSourceUrls(report);

    console.log(`[RESEARCH] Completed in ${(durationMs / 1000).toFixed(1)}s, ${sources.length} sources`);

    // Store as high-importance semantic memory
    let memoryId: string | undefined;
    if (config.save_to_memory && report) {
        try {
            memoryId = await saveMemory({
                content: `[Research: "${request.topic}"]\n\n${report}`,
                type: "semantic",
                importance: 0.9, // Research is high-value knowledge
                tags: ["research", "deep_knowledge", ...extractTopics(request.topic)],
                source: "user_interaction",
            });
            console.log(`[RESEARCH] Saved to memory: ${memoryId.slice(0, 8)}`);
        } catch (e) {
            console.warn("[RESEARCH] Failed to save to memory:", e);
        }
    }

    return {
        success: true,
        report,
        sources,
        memoryId,
        model_used: model,
        duration_ms: durationMs,
    };
}

/**
 * Extract URLs from a research report (looks for markdown links and bare URLs)
 */
function extractSourceUrls(report: string): string[] {
    const urls = new Set<string>();

    // Markdown links: [text](url)
    const mdLinks = report.matchAll(/\[.*?\]\((https?:\/\/[^\s)]+)\)/g);
    for (const match of mdLinks) urls.add(match[1]);

    // Bare URLs
    const bareUrls = report.matchAll(/(?<!\()(https?:\/\/[^\s\])>,]+)/g);
    for (const match of bareUrls) urls.add(match[1]);

    return Array.from(urls);
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
