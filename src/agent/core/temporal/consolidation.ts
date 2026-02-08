/**
 * Memory Consolidation - "Sleep" Cycle
 *
 * Periodically compresses episodic memories into semantic summaries
 * and prunes low-value memories to prevent unbounded growth.
 *
 * Flow:
 *   Episodic memories (many, noisy)
 *           |
 *           v [consolidation]
 *   Semantic memories (few, compressed)
 *           |
 *           v [pruning]
 *   Discarded (low-value episodics)
 */

import { isDisabled } from '../../../eval/evalConfig.js';
import {
    getAllMemories,
    createMemory,
    deleteMemory,
    getMemoryCount,
    getMetadata,
    setMetadata,
    decayUnaccessedMemories,
} from './memoryStore';
import { LongTermMemory } from './memoryTypes';
import { generateEmbedding, cosineSimilarity } from './embedding';
import { invokeLLM, getLLM } from '../llmFactory';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

// Consolidation settings
const CONSOLIDATION_INTERVAL_HOURS = 24;  // Minimum hours between consolidations
const MIN_INTERACTIONS_FOR_CONSOLIDATION = 20;  // Minimum interactions before consolidation
const CLUSTER_SIMILARITY_THRESHOLD = 0.75;  // Memories more similar than this are clustered
const MIN_CLUSTER_SIZE = 2;  // Minimum memories to form a cluster
const PRUNE_AFTER_DAYS = 7;  // Prune untouched episodics after this many days
const PRUNE_ACCESS_THRESHOLD = 0;  // Memories with this or fewer accesses are prunable
const DECAY_DELTA = 0.15;  // 15% importance decay per consolidation for unaccessed memories

export interface ConsolidationResult {
    episodics_processed: number;
    clusters_found: number;
    semantics_created: number;
    memories_decayed: number;
    memories_pruned: number;
    duration_ms: number;
}

/**
 * Check if consolidation should run
 */
export function shouldConsolidate(): boolean {
    const lastConsolidation = getMetadata('last_consolidation');
    const interactionCount = parseInt(getMetadata('interaction_count') || '0', 10);

    if (!lastConsolidation) {
        // Never consolidated, check interaction count
        return interactionCount >= MIN_INTERACTIONS_FOR_CONSOLIDATION;
    }

    const lastDate = new Date(lastConsolidation);
    const hoursSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);

    return hoursSince >= CONSOLIDATION_INTERVAL_HOURS &&
        interactionCount >= MIN_INTERACTIONS_FOR_CONSOLIDATION;
}

/**
 * Main consolidation function - the "sleep" cycle
 */
export async function consolidateMemories(): Promise<ConsolidationResult> {
    if (isDisabled('disableConsolidation')) {
        return { episodics_processed: 0, clusters_found: 0, semantics_created: 0, memories_decayed: 0, memories_pruned: 0, duration_ms: 0 };
    }
    const startTime = Date.now();
    console.log('[CONSOLIDATION] Starting memory consolidation (sleep cycle)...');

    // Get all episodic memories
    const allMemories = getAllMemories(10000);
    const episodics = allMemories.filter(m => m.type === 'episodic');

    console.log(`[CONSOLIDATION] Found ${episodics.length} episodic memories`);

    // Step 1: Cluster similar episodic memories
    const clusters = clusterMemories(episodics);
    console.log(`[CONSOLIDATION] Found ${clusters.length} clusters`);

    // Step 2: For each cluster, create a semantic summary
    let semanticsCreated = 0;
    for (const cluster of clusters) {
        if (cluster.length >= MIN_CLUSTER_SIZE) {
            const success = await createSemanticFromCluster(cluster);
            if (success) semanticsCreated++;
        }
    }

    // Step 3: Decay importance of memories not accessed since last consolidation
    const lastConsolidation = getMetadata('last_consolidation') || new Date(0).toISOString();
    const decayedCount = decayUnaccessedMemories(lastConsolidation, DECAY_DELTA);
    if (decayedCount > 0) {
        console.log(`[CONSOLIDATION] Decayed importance for ${decayedCount} unaccessed memories`);
    }

    // Step 4: Prune old, untouched episodic memories
    const prunedCount = pruneStaleMemories(episodics);

    // Update consolidation metadata
    setMetadata('last_consolidation', new Date().toISOString());

    // Reset interaction count after consolidation
    const currentCount = parseInt(getMetadata('interaction_count') || '0', 10);
    setMetadata('interaction_count', Math.max(0, currentCount - MIN_INTERACTIONS_FOR_CONSOLIDATION).toString());

    const result: ConsolidationResult = {
        episodics_processed: episodics.length,
        clusters_found: clusters.length,
        semantics_created: semanticsCreated,
        memories_decayed: decayedCount,
        memories_pruned: prunedCount,
        duration_ms: Date.now() - startTime,
    };

    console.log(`[CONSOLIDATION] Complete: ${semanticsCreated} semantics created, ${decayedCount} decayed, ${prunedCount} pruned (${result.duration_ms}ms)`);
    return result;
}

/**
 * Cluster memories by embedding similarity
 */
function clusterMemories(memories: LongTermMemory[]): LongTermMemory[][] {
    if (memories.length === 0) return [];

    const clusters: LongTermMemory[][] = [];
    const assigned = new Set<string>();

    for (const memory of memories) {
        if (assigned.has(memory.id)) continue;

        // Find all similar memories
        const cluster: LongTermMemory[] = [memory];
        assigned.add(memory.id);

        for (const other of memories) {
            if (assigned.has(other.id)) continue;

            const similarity = cosineSimilarity(memory.embedding, other.embedding);
            if (similarity >= CLUSTER_SIMILARITY_THRESHOLD) {
                cluster.push(other);
                assigned.add(other.id);
            }
        }

        clusters.push(cluster);
    }

    // Filter to only clusters with minimum size
    return clusters.filter(c => c.length >= MIN_CLUSTER_SIZE);
}

/**
 * Create a semantic memory from a cluster of episodic memories
 */
async function createSemanticFromCluster(cluster: LongTermMemory[]): Promise<boolean> {
    try {
        const llm = getLLM();

        // Format cluster content for LLM
        const clusterContent = cluster
            .map((m, i) => `${i + 1}. ${m.content}`)
            .join('\n');

        const prompt = `You are consolidating memories for an AI agent.
Given these related episodic memories:

${clusterContent}

Create a single semantic insight that captures the essential learning or pattern from these experiences.
The insight should be:
- Concise (1-2 sentences)
- Generalizable (not tied to specific instances)
- Actionable (useful for future decisions)

Respond with just the insight, no explanation.`;

        const response = await invokeLLM(llm, [
            new SystemMessage('You extract semantic insights from episodic memories.'),
            new HumanMessage(prompt),
        ]);

        // Create the semantic memory
        const embedding = await generateEmbedding(response);

        createMemory({
            created_at: new Date().toISOString(),
            content: response,
            embedding,
            type: 'semantic',
            importance: Math.max(...cluster.map(m => m.importance)), // Inherit highest importance
            arousal: Math.max(...cluster.map(m => m.arousal ?? 0)), // Inherit strongest arousal
            tags: ['consolidated', ...extractCommonTags(cluster)],
            source: 'consolidation',
            base_decay_rate: 0.1,  // Semantics decay very slowly
        });

        console.log(`[CONSOLIDATION] Created semantic: "${response.slice(0, 50)}..."`);
        return true;
    } catch (error: any) {
        console.error('[CONSOLIDATION] Failed to create semantic:', error.message);
        return false;
    }
}

/**
 * Extract common tags from a cluster of memories
 */
function extractCommonTags(cluster: LongTermMemory[]): string[] {
    const tagCounts = new Map<string, number>();

    for (const memory of cluster) {
        for (const tag of memory.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
    }

    // Return tags that appear in at least half the cluster
    const threshold = cluster.length / 2;
    return Array.from(tagCounts.entries())
        .filter(([_, count]) => count >= threshold)
        .map(([tag]) => tag)
        .slice(0, 5);  // Max 5 tags
}

/**
 * Prune old, untouched episodic memories
 */
function pruneStaleMemories(episodics: LongTermMemory[]): number {
    const now = Date.now();
    const pruneThresholdMs = PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    for (const memory of episodics) {
        const createdAt = new Date(memory.created_at).getTime();
        const age = now - createdAt;

        // Prune if: old enough AND never accessed AND low importance
        if (age >= pruneThresholdMs &&
            memory.access_count <= PRUNE_ACCESS_THRESHOLD &&
            memory.importance < 0.5) {

            try {
                deleteMemory(memory.id);
                prunedCount++;
            } catch (e) {
                // Continue on error
            }
        }
    }

    if (prunedCount > 0) {
        console.log(`[CONSOLIDATION] Pruned ${prunedCount} stale memories`);
    }
    return prunedCount;
}

/**
 * Get consolidation status
 */
export function getConsolidationStatus(): {
    lastConsolidation: string | null;
    hoursSinceConsolidation: number | null;
    shouldConsolidate: boolean;
    memoryCount: number;
} {
    const lastConsolidation = getMetadata('last_consolidation');
    const memoryCount = getMemoryCount();

    let hoursSinceConsolidation: number | null = null;
    if (lastConsolidation) {
        hoursSinceConsolidation = (Date.now() - new Date(lastConsolidation).getTime()) / (1000 * 60 * 60);
    }

    return {
        lastConsolidation,
        hoursSinceConsolidation,
        shouldConsolidate: shouldConsolidate(),
        memoryCount,
    };
}
