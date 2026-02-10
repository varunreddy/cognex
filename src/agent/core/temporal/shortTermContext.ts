/**
 * Short-term Memory Context Manager
 * Manages working memory with TTL-based decay and eviction
 */

import { ShortTermSlot, LongTermMemory, ActivatedMemory, RetrievalParams } from './memoryTypes';
import {
    getShortTermContext,
    loadToShortTerm,
    evictFromShortTerm,
    evictExpiredMemories,
    getMemory,
} from './memoryStore';
import { calculateTTL } from './retrieval';

import { cosineSimilarity } from './embedding';

const DEFAULT_PARAMS: RetrievalParams = {
    alpha: 0.5,
    beta: 0.1,
    min_ttl: 60,
    max_ttl: 3600,
    link_threshold: 0.3,
    spread_depth: 2,
};

// Hard cap on short-term memory items to prevent context explosion
let MAX_SHORT_TERM_ITEMS = 12; // Moderate expansion: better continuity without excessive recency bias

/** Override the STM capacity (used by eval harness) */
export function setMaxShortTermItems(n: number): void {
    MAX_SHORT_TERM_ITEMS = n;
}

/** Reset STM capacity to default */
export function resetMaxShortTermItems(): void {
    MAX_SHORT_TERM_ITEMS = 12;
}

/**
 * Load activated memories into short-term context
 * Implements:
 * 1. Semantic Deduplication (Merge if sim > 0.9)
 * 2. Competitive Eviction (Hard cap at MAX_STM_ITEMS)
 */
export function loadIntoShortTerm(
    activatedMemories: ActivatedMemory[],
    params: Partial<RetrievalParams> = {}
): void {
    const currentTime = new Date();
    const currentSlots = getShortTermContext(); // Get existing STM

    // 1. Process each new memory (Deduplicate & Merge)
    for (const { memory, activation } of activatedMemories) {
        // Check for duplicates in current STM
        let isDuplicate = false;
        let duplicateSlot: ShortTermSlot | null = null;

        for (const slot of currentSlots) {
            // Check exact ID match first
            if (slot.memory_id === memory.id) {
                isDuplicate = true;
                duplicateSlot = slot;
                break;
            }

            // Check semantic similarity (Merge near-duplicates)
            const existingMem = getMemory(slot.memory_id);
            if (existingMem && existingMem.embedding && memory.embedding) {
                const sim = cosineSimilarity(existingMem.embedding, memory.embedding);
                if (sim > 0.9) {
                    console.log(`[STM] Merging similar memory (sim: ${sim.toFixed(2)}): ${memory.id.substring(0, 8)} -> ${slot.memory_id.substring(0, 8)}`);
                    isDuplicate = true;
                    duplicateSlot = slot;
                    break;
                }
            }
        }

        let ttlSeconds = calculateTTL(activation, params);

        // Cap TTL for non-episodic memories (semantic/procedural) to 10 minutes.
        // These are always retrievable from LTM, so they don't need to park in STM.
        const MAX_SEMANTIC_TTL = 600; // 10 minutes
        if (memory.type !== 'episodic' && ttlSeconds > MAX_SEMANTIC_TTL) {
            ttlSeconds = MAX_SEMANTIC_TTL;
        }

        // Arousal TTL boost: emotionally intense memories stick in working memory longer.
        // A fully aroused memory gets up to 50% more TTL (mirrors emotional enhancement effect).
        const arousal = memory.arousal ?? 0;
        if (arousal > 0.3) {
            ttlSeconds = Math.round(ttlSeconds * (1 + arousal * 0.5));
        }

        const expiresAt = new Date(currentTime.getTime() + ttlSeconds * 1000).toISOString();

        if (isDuplicate && duplicateSlot) {
            // Always refresh if retrieved again. This mimics biological reconsolidation
            // and ensures the "Freshness Boost" applies to recently accessed memories.


            // MERGE POLICY: Update existing slot if new activation is higher or fresh
            // We reinforce the existing memory slot
            const newWeight = Math.max(duplicateSlot.retrieval_weight, activation);
            const newTTL = Math.max(duplicateSlot.ttl_seconds, ttlSeconds);

            const updatedSlot: ShortTermSlot = {
                ...duplicateSlot,
                loaded_at: currentTime.toISOString(), // Refresh timestamp
                ttl_seconds: newTTL,
                expires_at: new Date(currentTime.getTime() + newTTL * 1000).toISOString(),
                retrieval_weight: newWeight
            };
            loadToShortTerm(updatedSlot);
        } else {
            // New unique memory
            const slot: ShortTermSlot = {
                memory_id: memory.id,
                loaded_at: currentTime.toISOString(),
                ttl_seconds: ttlSeconds,
                expires_at: expiresAt,
                retrieval_weight: activation,
            };
            loadToShortTerm(slot);
        }
    }

    // 2. Competitive Eviction (Enforce Hard Cap)
    performCompetitiveEviction();
}

/**
 * Enforce hard cap by evicting weakest memories
 */
function performCompetitiveEviction(): void {
    const slots = getShortTermContext();

    if (slots.length <= MAX_SHORT_TERM_ITEMS) return;

    // Calculate score for each slot: Strength * Weight * (1 + arousal bonus)
    // Emotionally intense memories resist eviction (emotional enhancement effect)
    const scoredSlots = slots.map(slot => {
        const strength = getCurrentStrength(slot);
        const memory = getMemory(slot.memory_id);
        const arousalBonus = memory ? (memory.arousal ?? 0) * 0.3 : 0;

        let score = strength * slot.retrieval_weight * (1 + arousalBonus);

        // FRESHNESS BOOST: Protect items loaded in the last 10 seconds
        // This ensures that new auto-retrieved memories (like the user msg just received)
        // are not immediately evicted if STM is full of high-arousal items.
        const ageSeconds = (new Date().getTime() - new Date(slot.loaded_at).getTime()) / 1000;
        if (ageSeconds < 10) {
            score += 10.0; // Massive boost to guarantee survival
        }

        return { slot, score };
    });

    // Sort by score ascending (weakest first)
    scoredSlots.sort((a, b) => a.score - b.score);

    // Evict excess
    const removeCount = slots.length - MAX_SHORT_TERM_ITEMS;
    console.log(`[STM] Cap exceeded (${slots.length}/${MAX_SHORT_TERM_ITEMS}). Evicting ${removeCount} weakest items.`);

    for (let i = 0; i < removeCount; i++) {
        const toRemove = scoredSlots[i];
        evictFromShortTerm(toRemove.slot.memory_id);
    }
}

/**
 * Refresh a memory already in short-term context (rehearsal effect)
 * Extends TTL by 50% when accessed again
 */
export function refreshMemory(memoryId: string): void {
    const slots = getShortTermContext();
    const slot = slots.find(s => s.memory_id === memoryId);

    if (!slot) {
        console.warn(`[STM] Cannot refresh: memory ${memoryId} not in short-term context`);
        return;
    }

    // Extend TTL by 50% (rehearsal effect)
    const newTTL = Math.round(slot.ttl_seconds * 1.5);
    const currentTime = new Date();
    const newExpiresAt = new Date(currentTime.getTime() + newTTL * 1000).toISOString();

    const refreshedSlot: ShortTermSlot = {
        ...slot,
        loaded_at: currentTime.toISOString(),
        ttl_seconds: newTTL,
        expires_at: newExpiresAt,
    };

    loadToShortTerm(refreshedSlot); // INSERT OR REPLACE
}

/**
 * Calculate current strength of a short-term memory (decays linearly)
 */
export function getCurrentStrength(slot: ShortTermSlot): number {
    const loadedAt = new Date(slot.loaded_at);
    const currentTime = new Date();
    const elapsedSeconds = (currentTime.getTime() - loadedAt.getTime()) / 1000;

    // Sigmoid decay: Maintains high strength for longer, then drops off rapidly
    // k=10 (steepness), midpoint=0.75 (drop occurs at 75% of TTL)
    // Formula: 1 / (1 + e^(k * (elapsed/ttl - midpoint)))
    const normalizedElapsed = elapsedSeconds / slot.ttl_seconds;
    const k = 10;
    const midpoint = 0.75;

    const strength = 1 / (1 + Math.exp(k * (normalizedElapsed - midpoint)));

    // Clamp to [0, 1] just in case
    return Math.max(0, Math.min(1, strength));
}

/**
 * Evict all expired memories from short-term context
 */
export function performEviction(): number {
    const currentTime = new Date().toISOString();
    const evictedCount = evictExpiredMemories(currentTime);

    if (evictedCount > 0) {
        console.log(`[STM] Evicted ${evictedCount} expired memories`);
    }

    return evictedCount;
}

/**
 * Get current short-term context as formatted text for LLM prompt
 */
export function getContextForPrompt(): string {
    // First, evict expired memories
    performEviction();

    const slots = getShortTermContext();

    // Build temporal state section
    const temporalState = getTemporalState();

    if (slots.length === 0) {
        return `${temporalState}\n\n## Active Memories\nNo active memories in short-term context.`;
    }

    const memoryTexts: string[] = [];

    for (const slot of slots) {
        const memory = getMemory(slot.memory_id);
        if (!memory) continue;

        const strength = getCurrentStrength(slot);
        // Format: [strength] [type] [time] - content
        const timestamp = new Date(memory.created_at).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata',
        });
        const strengthBar = '\u2588'.repeat(Math.round(strength * 5)); // Visual strength indicator
        const typeLabel = `[${memory.type}]`;
        memoryTexts.push(`[${strengthBar.padEnd(5, '\u2591')}] ${typeLabel} [${timestamp}] ${memory.content}`);
    }

    return `${temporalState}\n\n## Active Memories (${slots.length})\n\n${memoryTexts.join('\n')}`;
}

/**
 * Get temporal state for agent awareness
 * Provides current time context so the agent can reason about time
 */
export function getTemporalState(): string {
    const now = new Date();

    // Format current time in IST
    const timeString = now.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
    });
    const dateString = now.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Kolkata',
    });

    // Determine time of day in IST
    const istHour = parseInt(now.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
    }));
    let timeOfDay: string;
    if (istHour >= 5 && istHour < 12) {
        timeOfDay = 'morning';
    } else if (istHour >= 12 && istHour < 17) {
        timeOfDay = 'afternoon';
    } else if (istHour >= 17 && istHour < 21) {
        timeOfDay = 'evening';
    } else {
        timeOfDay = 'night';
    }

    const timezone = 'Asia/Kolkata (IST)';

    // Get last reflection time from metadata
    const { getMetadata } = require('./memoryStore');
    const lastReflection = getMetadata('last_reflection');
    const interactionCount = getMetadata('interaction_count') || '0';

    let lastReflectionText = 'Never';
    if (lastReflection) {
        const lastReflectionDate = new Date(lastReflection);
        const hoursSince = (now.getTime() - lastReflectionDate.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 1) {
            lastReflectionText = `${Math.round(hoursSince * 60)} minutes ago`;
        } else if (hoursSince < 24) {
            lastReflectionText = `${Math.round(hoursSince)} hours ago`;
        } else {
            lastReflectionText = `${Math.round(hoursSince / 24)} days ago`;
        }
    }

    return `## Temporal State
- **Current Time**: ${timeString} (${timeOfDay})
- **Date**: ${dateString}
- **Timezone**: ${timezone}
- **Interactions**: ${interactionCount} total
- **Last Reflection**: ${lastReflectionText}`;
}

/**
 * Get all active memories with full details
 */
export function getActiveMemories(): Array<{ memory: LongTermMemory; slot: ShortTermSlot; strength: number }> {
    performEviction();

    const slots = getShortTermContext();
    const results: Array<{ memory: LongTermMemory; slot: ShortTermSlot; strength: number }> = [];

    for (const slot of slots) {
        const memory = getMemory(slot.memory_id);
        if (!memory) continue;

        const strength = getCurrentStrength(slot);

        results.push({ memory, slot, strength });
    }

    // Sort by strength (strongest first)
    results.sort((a, b) => b.strength - a.strength);

    return results;
}

/**
 * Get human-readable age of a memory
 */
function getMemoryAge(timestamp: string): string {
    const created = new Date(timestamp);
    const now = new Date();
    const ageMs = now.getTime() - created.getTime();

    const ageMinutes = ageMs / (1000 * 60);
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageMinutes < 60) {
        return `${Math.round(ageMinutes)}m ago`;
    } else if (ageHours < 24) {
        return `${Math.round(ageHours)}h ago`;
    } else {
        return `${Math.round(ageDays)}d ago`;
    }
}

/**
 * Clear all short-term context (hard reset)
 */
export function clearShortTermContext(): void {
    const slots = getShortTermContext();
    for (const slot of slots) {
        evictFromShortTerm(slot.memory_id);
    }
    console.log('[STM] Cleared all short-term context');
}

/**
 * Get statistics about short-term context
 */
export function getShortTermStats(): {
    active_count: number;
    avg_strength: number;
    avg_ttl: number;
    oldest_loaded: string | null;
} {
    const active = getActiveMemories();

    if (active.length === 0) {
        return {
            active_count: 0,
            avg_strength: 0,
            avg_ttl: 0,
            oldest_loaded: null,
        };
    }

    const avgStrength = active.reduce((sum, a) => sum + a.strength, 0) / active.length;
    const avgTTL = active.reduce((sum, a) => sum + a.slot.ttl_seconds, 0) / active.length;
    const oldest = active.reduce((oldest, a) =>
        a.slot.loaded_at < oldest.slot.loaded_at ? a : oldest
    );

    return {
        active_count: active.length,
        avg_strength: avgStrength,
        avg_ttl: Math.round(avgTTL),
        oldest_loaded: oldest.slot.loaded_at,
    };
}
