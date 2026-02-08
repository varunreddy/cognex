/**
 * Search Skill — Agent-facing Interface
 *
 * The agent invokes this skill to acquire external knowledge
 * when needed for accurate answers or current information.
 * Results are synthesized by the search subagent and stored
 * in temporal memory for future retrieval.
 */

import { invokeSearchAgent, SearchRequest, SearchResponse } from "./searchAgent.js";

export interface SearchSkillParams {
    query: string;
    reason?: string;
    depth?: "quick" | "thorough";
}

export interface SearchSkillResult {
    query: string;
    knowledge: string;
    sources: string[];
    success: boolean;
    memoryId?: string;
}

/**
 * Execute search skill
 */
export async function executeSearchSkill(params: SearchSkillParams): Promise<SearchSkillResult> {
    console.log(`[SEARCH_SKILL] Query: "${params.query.slice(0, 60)}..."`);
    if (params.reason) {
        console.log(`[SEARCH_SKILL] Reason: ${params.reason}`);
    }

    try {
        const searchRequest: SearchRequest = {
            query: params.query,
            context: params.reason,
            depth: params.depth || "quick",
        };

        const response = await invokeSearchAgent(searchRequest);

        return {
            query: params.query,
            knowledge: response.knowledge,
            sources: response.sources,
            success: response.success,
            memoryId: response.memoryId,
        };
    } catch (error: any) {
        console.error(`[SEARCH_SKILL] Error: ${error.message}`);
        return {
            query: params.query,
            knowledge: `Search failed: ${error.message}`,
            sources: [],
            success: false,
        };
    }
}

/**
 * Check if search is needed for a query
 */
export function shouldSearchForQuery(query: string): boolean {
    const searchIndicators = [
        /latest|recent|new|today|this week|this month|current|now|upcoming/i,
        /what.*news|what.*happening|what.*latest|what.*trending/i,
        /how much|how many|what.*price|what.*cost/i,
        /compare|difference|vs\.|versus/i,
        /weather|stock|crypto|market|finance|sports|politics/i,
        /date.*today|time.*now|schedule|when/i,
    ];

    return searchIndicators.some(pattern => pattern.test(query));
}

/**
 * Get search skill description for agent context
 */
export function getSearchSkillDescription(): string {
    return `
## Search Skill — Web Search via Tavily

**Purpose:** Acquire current information or external knowledge

**When to use:**
- You need current/recent information (news, prices, events)
- You're unsure about factual claims
- Questions about recent events, releases, or changes

**Usage:**
\`\`\`json
{
  "action_type": "web_search",
  "parameters": {
    "query": "Your search question here",
    "reason": "Why you need this information",
    "depth": "quick"
  }
}
\`\`\`

**Parameters:**
- query (required): What to search for
- reason (optional): Why you need this (helps context)
- depth (optional): "quick" (default, 5 results) or "thorough" (10 results)

**Returns:**
- knowledge: Synthesized knowledge from search results
- sources: URLs of sources used
- memoryId: Stored in temporal memory for future reference
`;
}
