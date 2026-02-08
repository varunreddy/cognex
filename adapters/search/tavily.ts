/**
 * Tavily Search API Client
 *
 * Web search via Tavily HTTP API.
 * Requires TAVILY_API_KEY environment variable or config.
 */

export interface TavilySearchOptions {
    maxResults?: number;
    searchDepth?: "basic" | "advanced";
    topic?: "general" | "news";
    includeAnswer?: boolean;
    includeImages?: boolean;
    includeRawContent?: boolean;
}

export interface TavilySearchResult {
    title: string;
    url: string;
    content: string;
    score: number;
    rawContent?: string;
}

export interface TavilySearchResponse {
    query: string;
    results: TavilySearchResult[];
    responseTime: number;
    answer?: string;
}

/**
 * Search the web using Tavily HTTP API
 * https://docs.tavily.com/docs/tavily-api/rest_api
 */
export async function searchViaTavily(
    query: string,
    options: TavilySearchOptions = {}
): Promise<TavilySearchResponse> {
    const {
        maxResults = 5,
        searchDepth = "basic",
        topic = "general",
        includeAnswer = true,
        includeImages = false,
        includeRawContent = false,
    } = options;

    console.log(`[TAVILY] Searching: "${query.slice(0, 50)}..."`);

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        throw new Error("TAVILY_API_KEY environment variable is missing");
    }

    const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: searchDepth,
            topic,
            include_answer: includeAnswer,
            include_images: includeImages,
            include_raw_content: includeRawContent,
            max_results: maxResults,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Tavily API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;

    const searchResponse: TavilySearchResponse = {
        query,
        results: (data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
            rawContent: r.raw_content,
        })),
        responseTime: data.response_time || 0,
        answer: data.answer,
    };

    console.log(`[TAVILY] Found ${searchResponse.results.length} results. Answer: ${!!searchResponse.answer}`);
    return searchResponse;
}

/**
 * Extract answer from Tavily search (if available)
 */
export function extractAnswer(response: TavilySearchResponse): string | null {
    return response.answer || null;
}

/**
 * Get top N results from search
 */
export function getTopResults(
    response: TavilySearchResponse,
    count: number = 3
): TavilySearchResult[] {
    return response.results
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, count);
}
