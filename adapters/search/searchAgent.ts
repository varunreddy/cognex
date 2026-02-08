/**
 * Search Subagent
 *
 * LLM-powered knowledge acquisition via web search.
 *
 * Flow:
 *   1. Agent invokes with query + context
 *   2. Searches via Tavily API
 *   3. LLM synthesizes results into actionable knowledge
 *   4. Knowledge is stored in temporal memory as semantic memory
 *   5. Returns summary to calling agent
 */

import { searchWeb, SearchResult } from "./searchTool.js";
import { saveMemory } from "../../src/agent/core/temporal/index.js";
import { getLLM, invokeLLM } from "../../src/agent/core/llmFactory.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

// Rate limiting
const MAX_SEARCHES_PER_RUN = 5;
let searchCountThisRun = 0;

export interface SearchRequest {
    query: string;
    context?: string;
    depth?: "quick" | "thorough";
}

export interface SearchResponse {
    success: boolean;
    knowledge: string;
    sources: string[];
    memoryId?: string;
    cached?: boolean;
}

/**
 * Invoke the search subagent
 */
export async function invokeSearchAgent(request: SearchRequest): Promise<SearchResponse> {
    console.log(`[SEARCH_AGENT] Query: "${request.query.slice(0, 60)}..."`);

    if (searchCountThisRun >= MAX_SEARCHES_PER_RUN) {
        console.warn(`[SEARCH_AGENT] Rate limit reached (${MAX_SEARCHES_PER_RUN}/run)`);
        return {
            success: false,
            knowledge: `Search rate limit reached. Maximum ${MAX_SEARCHES_PER_RUN} searches per run.`,
            sources: [],
        };
    }

    try {
        const searchResult = await searchWeb(request.query, {
            maxResults: request.depth === "thorough" ? 10 : 5,
            searchDepth: request.depth === "thorough" ? "advanced" : "basic",
            useCache: true,
        });

        searchCountThisRun++;

        const knowledge = await synthesizeKnowledge(
            request.query,
            searchResult,
            request.context
        );

        // Store in temporal memory as semantic knowledge
        let memoryId: string | undefined;
        try {
            memoryId = await saveMemory({
                content: `[Search: "${request.query}"]\n\n${knowledge}`,
                type: "semantic",
                importance: 0.7,
                tags: ["search", "external_knowledge", ...extractTopics(request.query)],
                source: "user_interaction",
            });
            console.log(`[SEARCH_AGENT] Saved to memory: ${memoryId.slice(0, 8)}`);
        } catch (e) {
            console.warn("[SEARCH_AGENT] Failed to save to memory:", e);
        }

        return {
            success: true,
            knowledge,
            sources: searchResult.results.map(r => r.url).filter(Boolean),
            memoryId,
        };
    } catch (error: any) {
        console.error("[SEARCH_AGENT] Error:", error.message);
        return {
            success: false,
            knowledge: `Search failed: ${error.message}`,
            sources: [],
        };
    }
}

async function synthesizeKnowledge(
    query: string,
    searchResult: SearchResult,
    context?: string
): Promise<string> {
    const llm = getLLM();

    const formattedResults = searchResult.results
        .slice(0, 5)
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
        .join("\n\n---\n\n");

    const systemPrompt = `You are a knowledge synthesizer for an autonomous agent.
Your job is to distill web search results into clear, actionable knowledge.

Requirements:
- Be concise but informative (2-3 paragraphs max)
- Focus on facts and key insights
- Avoid unnecessary hedging or qualifications
- If results are poor quality, say so honestly`;

    const userPrompt = `Query: "${query}"
${context ? `\nContext: ${context}` : ""}

Search Results:
${formattedResults}

Synthesize this into useful knowledge for the agent.`;

    try {
        return await invokeLLM(llm, [
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ]);
    } catch (error: any) {
        console.error("[SEARCH_AGENT] LLM synthesis failed:", error.message);
        return searchResult.summary;
    }
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

export function resetSearchRateLimit(): void {
    searchCountThisRun = 0;
}

export function getSearchCount(): number {
    return searchCountThisRun;
}
