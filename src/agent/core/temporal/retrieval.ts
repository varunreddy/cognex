import { isDisabled } from '../../../eval/evalConfig.js';
import {
    LongTermMemory,
    MemorySearchResult,
    ActivatedMemory,
    RetrievalParams,
} from './memoryTypes.js';
import {
    getMemory,
    getAllMemories,
    updateRetrievalStats,
    getOutgoingLinks,
    bm25Search,
    vectorSearch,
    isVectorSearchAvailable,
} from './memoryStore.js';
import { generateEmbedding, cosineSimilarity } from './embedding.js';

// Default retrieval parameters
const DEFAULT_PARAMS: RetrievalParams = {
    alpha: 0.5, // Frequency weight
    beta: 0.1, // Recency decay rate
    min_ttl: 60, // 1 minute
    max_ttl: 3600, // 1 hour
    link_threshold: 0.3, // Min weight to traverse edges
    spread_depth: 2, // Max hops in graph
};

let globalRetrievalParams: Partial<RetrievalParams> = {};

export function setGlobalRetrievalParams(params: Partial<RetrievalParams>) {
    globalRetrievalParams = { ...globalRetrievalParams, ...params };
    return { ...DEFAULT_PARAMS, ...globalRetrievalParams };
}

export function getGlobalRetrievalParams() {
    return { ...DEFAULT_PARAMS, ...globalRetrievalParams };
}

// RRF constant (standard value from literature)
const RRF_K = 60;
const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "if", "then", "else", "to", "for", "of", "on",
    "in", "at", "by", "with", "from", "as", "is", "are", "was", "were", "be", "been",
    "it", "this", "that", "these", "those", "i", "you", "we", "they", "he", "she",
    "what", "how", "why", "when", "where", "which", "should", "would", "could", "have",
    "has", "had", "do", "does", "did", "my", "your", "our", "their", "me", "us"
]);

function extractQueryTokens(text: string): string[] {
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(t => t.length >= 3 && !STOP_WORDS.has(t));
    return Array.from(new Set(tokens));
}

function lexicalOverlapScore(queryTokens: string[], memory: LongTermMemory): number {
    if (queryTokens.length === 0) return 0;
    const haystack = `${memory.content} ${memory.tags.join(" ")}`.toLowerCase();
    let matches = 0;
    for (const token of queryTokens) {
        if (haystack.includes(token)) matches++;
    }
    return matches / queryTokens.length;
}

function rerankByRelevance(
    query: string,
    results: MemorySearchResult[],
    params: Partial<RetrievalParams> = {}
): MemorySearchResult[] {
    const queryTokens = extractQueryTokens(query);
    if (results.length === 0) return results;

    const scored = results.map(result => {
        const overlap = lexicalOverlapScore(queryTokens, result.memory);
        const retrievalWeight = computeRetrievalWeight(result.memory, params);
        const semantic = Math.max(0, result.similarity || 0);

        // Blend semantic, retrieval strength, and lexical query alignment.
        // We keep lexical lower than semantic to avoid BM25-only keyword traps.
        const score = (semantic * 0.55) + (retrievalWeight * 0.25) + (overlap * 0.20);

        // Return enriched result with relevance_score
        return {
            result: { ...result, relevance_score: score },
            score,
            overlap,
            semantic
        };
    });

    // Drop low-signal matches when we have enough candidates.
    const filtered = scored.filter(s => s.score >= 0.12 || s.overlap >= 0.20);
    const pool = filtered.length >= 3 ? filtered : scored;

    pool.sort((a, b) => b.score - a.score);
    return pool.map(s => s.result);
}

/**
 * Compute retrieval weight using logistic function
 * Formula: 1 / (1 + e^(-x))
 * where x = base_importance + (alpha * frequency_score) - (beta * recency_penalty)
 */
export function computeRetrievalWeight(
    memory: LongTermMemory,
    params: Partial<RetrievalParams> = {}
): number {
    const { alpha, beta } = { ...getGlobalRetrievalParams(), ...params };

    // Frequency component (grows with each access)
    // Use logarithmic scaling to prevent rich-get-richer saturation
    // Linear (old): 200 accesses -> score 100 (saturated)
    // Log (new): 200 accesses -> score ~5.3
    const frequencyScore = Math.log(memory.access_count + 1);

    // Recency component (penalizes old retrievals)
    const currentTime = new Date();
    const lastAccessed = memory.last_accessed ? new Date(memory.last_accessed) : new Date(memory.created_at);
    const timeSinceLastMs = Math.max(0, currentTime.getTime() - lastAccessed.getTime());
    const hoursSince = timeSinceLastMs / (1000 * 60 * 60);
    const recencyPenalty = Math.max(0, Math.min(hoursSince, 120));

    // Arousal component: emotionally intense memories are more retrievable
    // Scaled by 0.3 so a fully aroused memory adds ~0.3 to the logistic input
    const arousalBoost = (memory.arousal ?? 0) * 0.3;

    // Combined score
    const x = memory.importance + (alpha * frequencyScore) - (beta * recencyPenalty) + arousalBoost;

    // Logistic function (bounded 0-1)
    const weight = 1 / (1 + Math.exp(-x));

    return weight;
}

/**
 * Calculate TTL for short-term memory based on retrieval weight
 */
export function calculateTTL(retrievalWeight: number, params: Partial<RetrievalParams> = {}): number {
    const { min_ttl, max_ttl } = { ...getGlobalRetrievalParams(), ...params };
    return Math.round(min_ttl + retrievalWeight * (max_ttl - min_ttl));
}

/**
 * Semantic search: Find memories similar to query text using embeddings
 * Uses sqlite-vec O(log n) index when available, falls back to brute-force
 */
export async function semanticSearch(
    query: string,
    topK: number = 5,
    params: Partial<RetrievalParams> = {}
): Promise<MemorySearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Try indexed vector search first (O(log n))
    if (isVectorSearchAvailable()) {
        const vecResults = vectorSearch(queryEmbedding, topK);

        if (vecResults.length > 0) {
            console.log(`[RETRIEVAL] Using sqlite-vec index (${vecResults.length} results)`);

            const results: MemorySearchResult[] = [];
            for (const { memoryId, distance } of vecResults) {
                const memory = getMemory(memoryId);
                if (!memory) continue;

                // Convert cosine distance to similarity (distance 0 = similarity 1)
                const similarity = 1 - (distance / 2);
                const retrievalWeight = computeRetrievalWeight(memory, params);

                results.push({
                    memory,
                    similarity,
                    retrieval_weight: retrievalWeight,
                });
            }

            return results;
        }
    }

    // Fallback: brute-force search (O(n))
    console.log('[RETRIEVAL] Using brute-force search');
    const allMemories = getAllMemories(1000);

    const results: MemorySearchResult[] = allMemories.map(memory => {
        const similarity = cosineSimilarity(queryEmbedding, memory.embedding);
        const retrievalWeight = computeRetrievalWeight(memory, params);

        return {
            memory,
            similarity,
            retrieval_weight: retrievalWeight,
        };
    });

    // Sort by similarity
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, topK);
}

/**
 * Reciprocal Rank Fusion (RRF) - combines multiple rankings
 * Score = Σ 1/(k + rank_i) for each ranking system
 */
function reciprocalRankFusion(
    bm25Results: Array<{ memory: LongTermMemory; bm25Score: number }>,
    semanticResults: MemorySearchResult[],
    params: Partial<RetrievalParams> = {}
): MemorySearchResult[] {
    const scoreMap = new Map<string, { memory: LongTermMemory; rrfScore: number; similarity: number }>();

    // Add BM25 contributions (already sorted by rank)
    for (let i = 0; i < bm25Results.length; i++) {
        const { memory } = bm25Results[i];
        const rrfContribution = 1 / (RRF_K + i + 1);

        const existing = scoreMap.get(memory.id);
        if (existing) {
            existing.rrfScore += rrfContribution;
        } else {
            scoreMap.set(memory.id, {
                memory,
                rrfScore: rrfContribution,
                similarity: 0, // Will be updated if in semantic results
            });
        }
    }

    // Add semantic search contributions
    for (let i = 0; i < semanticResults.length; i++) {
        const { memory, similarity } = semanticResults[i];
        const rrfContribution = 1 / (RRF_K + i + 1);

        const existing = scoreMap.get(memory.id);
        if (existing) {
            existing.rrfScore += rrfContribution;
            existing.similarity = Math.max(existing.similarity, similarity);
        } else {
            scoreMap.set(memory.id, {
                memory,
                rrfScore: rrfContribution,
                similarity,
            });
        }
    }

    // Convert to results and sort by RRF score
    const results: MemorySearchResult[] = Array.from(scoreMap.values()).map(item => ({
        memory: item.memory,
        similarity: item.similarity,
        retrieval_weight: computeRetrievalWeight(item.memory, params),
        rrf_score: item.rrfScore,
    }));

    results.sort((a, b) => (b.rrf_score || 0) - (a.rrf_score || 0));

    return results;
}

/**
 * Hybrid retrieval: BM25 + Semantic search with RRF fusion
 */
export async function hybridSearch(
    query: string,
    topK: number = 5,
    params: Partial<RetrievalParams> = {}
): Promise<MemorySearchResult[]> {
    // Run both searches in parallel
    const [bm25Results, semanticResults] = await Promise.all([
        Promise.resolve(bm25Search(query, topK * 2)),  // Get more candidates
        semanticSearch(query, topK * 2, params),
    ]);

    console.log(`[RETRIEVAL] BM25: ${bm25Results.length} | Semantic: ${semanticResults.length}`);

    // Fuse rankings with RRF
    const fusedResults = reciprocalRankFusion(bm25Results, semanticResults, params);

    return fusedResults.slice(0, topK);
}

/**
 * Spreading activation: Traverse memory graph from seed memories
 */
export function spreadingActivation(
    seedMemories: MemorySearchResult[],
    params: Partial<RetrievalParams> = {}
): Map<string, ActivatedMemory> {
    const { link_threshold, spread_depth } = { ...getGlobalRetrievalParams(), ...params };

    const activatedMemories = new Map<string, ActivatedMemory>();

    // Initialize with seed memories (full activation)
    for (const result of seedMemories) {
        activatedMemories.set(result.memory.id, {
            memory: result.memory,
            activation: 1.0,
            depth: 0,
        });
    }

    // BFS traversal of the graph
    const queue: Array<{ memoryId: string; depth: number; activation: number }> = seedMemories.map(
        r => ({ memoryId: r.memory.id, depth: 0, activation: 1.0 })
    );

    while (queue.length > 0) {
        const current = queue.shift()!;

        // Stop if we've reached max depth
        if (current.depth >= spread_depth) {
            continue;
        }

        // Get outgoing links
        const links = getOutgoingLinks(current.memoryId);

        for (const link of links) {
            // Only traverse strong links
            if (link.weight < link_threshold) {
                continue;
            }

            // Calculate activation for linked memory
            // Weight by link strength, cosine similarity, and hop decay
            const hopDecay = 0.7; // Activation reduces by 30% per hop
            const similarityFactor = link.initial_similarity > 0 ? link.initial_similarity : link.weight;
            const linkedActivation = current.activation * similarityFactor * hopDecay;

            // Skip if already activated with higher activation
            const existing = activatedMemories.get(link.to_memory_id);
            if (existing && existing.activation >= linkedActivation) {
                continue;
            }

            // Load the linked memory
            const linkedMemory = getMemory(link.to_memory_id);
            if (!linkedMemory) continue;

            // Add to activated set
            activatedMemories.set(link.to_memory_id, {
                memory: linkedMemory,
                activation: linkedActivation,
                depth: current.depth + 1,
            });

            // Add to queue for further traversal
            queue.push({
                memoryId: link.to_memory_id,
                depth: current.depth + 1,
                activation: linkedActivation,
            });
        }
    }

    return activatedMemories;
}

/**
 * Main retrieval function: Hybrid search (BM25 + Semantic) + Spreading Activation
 */
export async function retrieve(
    query: string,
    options: {
        topK?: number;
        useSpreadingActivation?: boolean;
        useHybrid?: boolean;  // NEW: Enable/disable hybrid search
        params?: Partial<RetrievalParams>;
    } = {}
): Promise<ActivatedMemory[]> {
    const {
        topK = 5,
        useSpreadingActivation: rawSA = true,
        useHybrid = true,  // Default to hybrid
        params = {}
    } = options;

    // Eval guard: force spreading activation off when ablated
    const useSpreadingActivation = isDisabled('disableSpreadingActivation') ? false : rawSA;

    // Step 1: Get search results (hybrid or semantic-only)
    // We over-fetch (2x topK) to allow for deduplication
    let searchResults: MemorySearchResult[];
    const fetchLimit = topK * 3;

    if (useHybrid) {
        searchResults = await hybridSearch(query, fetchLimit, params);
    } else {
        searchResults = await semanticSearch(query, fetchLimit, params);
    }

    // Re-rank fused results with query-level relevance scoring.
    searchResults = rerankByRelevance(query, searchResults, params);

    // [DIVERSITY + DEDUP FILTER]
    // Filter out redundant memories (duplicate content).
    // Vector search can return many near-identical memories ("I posted X", "I just posted X").
    const uniqueResults: MemorySearchResult[] = [];
    const seenContent = new Set<string>();

    for (const result of searchResults) {
        // Simple deduplication: Check for 80% substring overlap or exact match
        // For efficiency, we just check if a significant prefix matches, or use a simplified hash
        const content = result.memory.content;

        // 1. Exact match check
        if (seenContent.has(content)) continue;

        // 2. Fuzzy match check (simple inclusion)
        let isRedundant = false;
        for (const seen of seenContent) {
            // If one is a substring of another (and long enough to matter)
            if (seen.length > 50 && (seen.includes(content) || content.includes(seen))) {
                isRedundant = true;
                break;
            }
            // Overlap check (first 30 chars match - unlikely for distinct thoughts)
            if (seen.length > 30 && content.length > 30 &&
                seen.substring(0, 30) === content.substring(0, 30)) {
                isRedundant = true;
                break;
            }
        }

        if (!isRedundant) {
            uniqueResults.push(result);
            seenContent.add(content);
        }

        if (uniqueResults.length >= topK) break;
    }

    searchResults = uniqueResults;

    if (!useSpreadingActivation) {
        // Return only direct search results
        // When skipping spreading activation, we treat the found memories as "seeds" (activation 1.0)
        // just like spreadingActivation() would. This ensures manual loads (like from adapter)
        // are prioritized in STM and not evicted immediately.
        return searchResults.map(r => ({
            memory: r.memory,
            activation: 1.0,
            depth: 0,
        }));
    }

    // Step 2: Spreading activation through graph
    const activatedMemories = spreadingActivation(searchResults, params);

    // Step 3: Update retrieval stats for directly searched memories only (depth 0)
    // Graph-traversal results (depth 1-2) should not inflate access counts
    const currentTime = new Date().toISOString();
    for (const [memoryId, activated] of activatedMemories) {
        if (activated.depth === 0) {
            updateRetrievalStats(memoryId, currentTime);
        }
    }

    // Convert to array and sort by activation
    const results = Array.from(activatedMemories.values());
    results.sort((a, b) => b.activation - a.activation);

    // Cap results to prevent STM thrashing (seeds + graph associations)
    return results.slice(0, topK * 2);
}

/**
 * Calculate combined relevance score for ranking
 */
export function calculateRelevanceScore(
    similarity: number,
    retrievalWeight: number,
    graphActivation: number = 1.0
): number {
    return 0.5 * similarity + 0.3 * retrievalWeight + 0.2 * graphActivation;
}
