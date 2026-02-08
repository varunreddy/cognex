/**
 * Temporal Memory System - Main Integration Module
 * Provides high-level API for the agent to use the memory system
 */

import { LongTermMemory, ActivatedMemory, MemoryStats } from './memoryTypes';
import { initializeDatabase, createMemory, createLink, getMemoryStats, vectorSearch, getMemory, updateRetrievalStats } from './memoryStore';
import { retrieve, computeRetrievalWeight } from './retrieval';
import { generateEmbedding, cosineSimilarity } from './embedding';
import { estimateArousal } from './arousal';
import { isDisabled } from '../../../eval/evalConfig.js';

// Cache for last retrieval (used when STM is ablated)
let lastRetrievedMemories: ActivatedMemory[] = [];
import {
    loadIntoShortTerm,
    refreshMemory,
    getContextForPrompt,
    getActiveMemories,
    clearShortTermContext,
    getShortTermStats,
    getTemporalState,
} from './shortTermContext';
import {
    performReflection,
    shouldReflect,
    incrementInteractionCount,
    getInteractionCount,
    saveInsightsAsMemories,
} from './reflection';
import {
    consolidateMemories,
    shouldConsolidate,
    getConsolidationStatus,
} from './consolidation';
export { runRecoverySequence } from './recovery';

// Initialize database on module load
let initialized = false;

function ensureInitialized(): void {
    if (!initialized) {
        initializeDatabase();
        initialized = true;
    }
}

/**
 * Save a new memory to long-term storage
 */
export async function saveMemory(params: {
    content: string;
    type: LongTermMemory['type'];
    importance?: number;
    tags?: string[];
    source?: LongTermMemory['source'];
    emotion?: string; // Optional emotion label for arousal estimation
}): Promise<string> {
    ensureInitialized();

    const {
        content,
        type,
        importance = 0.5,
        tags = [],
        source = 'user_interaction',
        emotion,
    } = params;

    // Estimate emotional arousal from content and optional emotion label
    const arousal = estimateArousal(content, emotion);

    // Generate embedding
    const embedding = await generateEmbedding(content);

    // --- DEDUPLICATION CHECK ---
    // Prevent verbatim duplicates for episodic memories within a short window
    if (type === 'episodic') {
        // Search for very similar memories
        // Distance < 0.15 => Similarity > 0.92 (approx)
        const candidates = vectorSearch(embedding, 1);

        if (candidates.length > 0 && candidates[0].distance < 0.15) {
            const existingId = candidates[0].memoryId;
            const existingMemory = getMemory(existingId);

            if (existingMemory && existingMemory.type === 'episodic') {
                // Widen dedup window to 24 hours to prevent daily repetition clutter
                const dedupeWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const memDate = new Date(existingMemory.created_at);

                // If created recently, treat as duplicate
                if (memDate > dedupeWindow) {
                    console.log(`[MEMORY] Duplicate suppressed (merged with ${existingId.substring(0, 8)}, distance: ${candidates[0].distance.toFixed(3)})`);
                    // Reinforce the existing memory instead of creating a new one
                    updateRetrievalStats(existingId, new Date().toISOString());
                    return existingId;
                }
            }
        }
    }

    // Create memory
    const memoryId = createMemory({
        created_at: new Date().toISOString(),
        content,
        embedding,
        type,
        importance,
        arousal,
        tags,
        source,
        base_decay_rate: 0.05,
    });

    // Auto-link to recent active memories (if semantically similar)
    await autoLinkToActiveMemories(memoryId, embedding);

    console.log(`[MEMORY] Saved ${type} memory: ${content.substring(0, 60)}...`);

    return memoryId;
}

/**
 * Retrieve relevant memories and load into short-term context
 */
export async function retrieveAndLoadContext(
    query: string,
    options: {
        topK?: number;
        useSpreadingActivation?: boolean;
    } = {}
): Promise<ActivatedMemory[]> {
    if (isDisabled('disableTemporalMemory')) return [];
    ensureInitialized();

    console.log(`[MEMORY] Retrieving memories for: "${query}"`);

    // Retrieve using semantic search + spreading activation
    const activatedMemories = await retrieve(query, options);

    // Load into short-term context (skip if STM ablated)
    if (!isDisabled('disableShortTermContext')) {
        loadIntoShortTerm(activatedMemories);
    } else {
        lastRetrievedMemories = activatedMemories;
    }

    console.log(`[MEMORY] Loaded ${activatedMemories.length} memories${isDisabled('disableShortTermContext') ? ' (STM bypassed)' : ' into short-term context'}`);

    return activatedMemories;
}

/**
 * Get formatted memory context for LLM prompt
 */
export function getMemoryContext(): string {
    if (isDisabled('disableTemporalMemory')) return "No memories available.";
    ensureInitialized();

    // When STM is ablated, format retrieved memories directly (no decay/eviction)
    if (isDisabled('disableShortTermContext')) {
        if (lastRetrievedMemories.length === 0) return "No memories available.";
        const lines = lastRetrievedMemories.map((m, i) =>
            `${i + 1}. [${m.memory.type}] ${m.memory.content}`
        );
        return `## Retrieved Memories (${lines.length}, no STM)\n\n${lines.join('\n')}`;
    }

    return getContextForPrompt();
}

/**
 * Trigger self-reflection if conditions are met
 */
export async function checkAndPerformReflection(): Promise<boolean> {
    ensureInitialized();

    const interactionCount = getInteractionCount();
    const { should, trigger } = shouldReflect(interactionCount);

    if (!should) {
        return false;
    }

    console.log(`[MEMORY] Self-reflection triggered (${trigger})`);

    const reflection = await performReflection(trigger);

    // Save insights as semantic memories
    await saveInsightsAsMemories(reflection.insights);

    return true;
}

/**
 * Manually trigger self-reflection
 */
export async function triggerReflection(): Promise<void> {
    ensureInitialized();
    const reflection = await performReflection('manual');
    await saveInsightsAsMemories(reflection.insights);
}

/**
 * Increment interaction counter (call after each agent run)
 */
export function recordInteraction(): void {
    ensureInitialized();
    incrementInteractionCount();
}

/**
 * Get memory system statistics
 */
export function getStats(): MemoryStats {
    ensureInitialized();
    return getMemoryStats();
}

/**
 * Get short-term context statistics
 */
export function getShortTermInfo() {
    ensureInitialized();
    return getShortTermStats();
}

/**
 * Get active memories with details
 */
export function getActive() {
    ensureInitialized();
    return getActiveMemories();
}

/**
 * Clear short-term context (hard reset)
 */
export function clearShortTerm(): void {
    ensureInitialized();
    clearShortTermContext();
}

/**
 * Get current temporal state (time awareness for agent)
 */
export function getCurrentTime(): string {
    ensureInitialized();
    return getTemporalState();
}

/**
 * Auto-link new memory to semantically similar active memories
 */
async function autoLinkToActiveMemories(memoryId: string, newEmbedding: number[]): Promise<void> {
    const activeMemories = getActiveMemories();

    for (const { memory } of activeMemories) {
        const similarity = cosineSimilarity(newEmbedding, memory.embedding);

        // If similarity is high enough, create a link
        if (similarity > 0.6) {
            const currentTime = new Date().toISOString();

            // Allow small float errors but clamp for DB constraint
            const safeWeight = Math.min(1.0, Math.max(0.0, similarity));

            createLink({
                from_memory_id: memoryId,
                to_memory_id: memory.id,
                weight: safeWeight,
                link_type: 'semantic',
                created_at: currentTime,
                last_updated: currentTime,
                co_retrieval_count: 0,
                initial_similarity: similarity,
            });

            console.log(
                `[MEMORY] Auto-linked to active memory ${memory.id.substring(0, 8)} (similarity: ${similarity.toFixed(2)})`
            );
        }
    }
}

/**
 * Search memories by keyword (for manual queries)
 */
export async function searchMemories(query: string, limit: number = 10): Promise<ActivatedMemory[]> {
    ensureInitialized();
    return await retrieve(query, { topK: limit, useSpreadingActivation: false });
}

/**
 * Run memory consolidation ("sleep" cycle)
 * Compresses episodic → semantic and prunes stale memories
 */
export async function runConsolidation() {
    ensureInitialized();
    return await consolidateMemories();
}

/**
 * Check if consolidation is due
 */
export function needsConsolidation(): boolean {
    ensureInitialized();
    return shouldConsolidate();
}

/**
 * Get consolidation status info
 */
export function getConsolidationInfo() {
    ensureInitialized();
    return getConsolidationStatus();
}

/**
 * Enhanced reflection check - also checks for consolidation
 */
export async function checkAndPerformMaintenance(): Promise<{
    reflected: boolean;
    consolidated: boolean;
}> {
    ensureInitialized();

    let reflected = false;
    let consolidated = false;

    // Check if reflection is due
    const interactionCount = getInteractionCount();
    const reflectionCheck = shouldReflect(interactionCount);

    if (reflectionCheck.should) {
        const reflection = await performReflection(reflectionCheck.trigger);
        await saveInsightsAsMemories(reflection.insights);
        reflected = true;
        console.log('[TEMPORAL] Self-reflection completed');
    }

    // Check if consolidation is due
    if (shouldConsolidate()) {
        await consolidateMemories();
        consolidated = true;
        console.log('[TEMPORAL] Memory consolidation completed');
    }

    return { reflected, consolidated };
}


/**
 * Reset the entire memory system (clears all memories)
 */
export function resetMemorySystem(): void {
    const { resetDatabase } = require('./memoryStore');
    resetDatabase();
    clearShortTermContext(); // Also clear in-memory context
    console.log('[TEMPORAL] Memory system reset complete');
}

// Re-export types for convenience
export type { LongTermMemory, ActivatedMemory, MemoryStats } from './memoryTypes';
