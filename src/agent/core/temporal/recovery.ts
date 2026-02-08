
import { ChatOpenAI } from '@langchain/openai';
import {
    semanticSearch,
} from './retrieval';
import {
    evictFromShortTerm,
} from './memoryStore';
import {
    updateMemoryImportance,
    updateMemoryMetadata,
    getMemory
} from './memoryStore';
import { loadLLMConfig } from '../llmConfig';
import { LongTermMemory, MemorySearchResult } from './memoryTypes';

interface BeliefCorrection {
    memoryId: string;
    reason: string;
    action: 'demote' | 'invalidated';
}

/**
 * Run a recovery sequence to invalidate stale beliefs
 */
export async function runRecoverySequence(issueContext: string): Promise<string> {
    console.log(`[RECOVERY] Starting sequence for: "${issueContext}"`);

    // 1. Find memories related to the issue
    // We search broadly using semantic search
    const candidates = await semanticSearch(issueContext, 20);

    if (candidates.length === 0) {
        return "No relevant memories found to recover.";
    }

    const memorySummaries = candidates
        .map((m: MemorySearchResult, i: number) => `[${i}] ID:${m.memory.id} (${m.memory.type}) "${m.memory.content}"`)
        .join('\n');

    // 2. Ask LLM to identify invalid beliefs
    const config = loadLLMConfig();
    const llm = new ChatOpenAI({
        apiKey: config?.api_key,
        modelName: config?.model || 'gpt-4o',
        temperature: 0.1, // Strict logic
        configuration: {
            baseURL: config?.base_url,
        },
    });

    const prompt = `
You are a Memory Surgeon for an AI agent.
The agent has memories that may be FALSE or OUTDATED because they were formed during a system failure that is now FIXED.

FIXED ISSUE: "${issueContext}"

Analyze the memories below. Which ones are likely "Anxiety", "False Beliefs", or "Error Logs" caused by this now-resolved issue?
Ignore memories that are just factual observations of the timestamp or unrelated topics.

MEMORIES:
${memorySummaries}

Return JSON:
{
  "corrections": [
    { "index": 0, "reason": "Memory acts on false premise that API key is missing", "action": "invalidated" }
  ]
}
If none, return { "corrections": [] }
`;

    try {
        const response = await llm.invoke(prompt);
        const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        let corrections: BeliefCorrection[] = [];

        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            corrections = parsed.corrections.map((c: any) => ({
                memoryId: candidates[c.index].memory.id,
                reason: c.reason,
                action: c.action
            }));
        }

        if (corrections.length === 0) {
            return "No beliefs needed revision.";
        }

        // 3. Apply corrections
        let count = 0;
        for (const correction of corrections) {
            console.log(`[RECOVERY] Correcting ${correction.memoryId.slice(0, 8)}: ${correction.reason}`);

            // Demote importance
            updateMemoryImportance(correction.memoryId, 0.1);

            // Update metadata
            const mem = getMemory(correction.memoryId);
            const metadata = mem?.metadata || {};
            metadata.belief_status = 'invalidated';
            metadata.invalidation_reason = correction.reason;
            metadata.invalidated_at = new Date().toISOString();

            updateMemoryMetadata(correction.memoryId, metadata);

            // Evict from STM immediately
            evictFromShortTerm(correction.memoryId);

            count++;
        }

        return `Successfully invalidated ${count} stale beliefs.`;

    } catch (error: any) {
        console.error("[RECOVERY] Failed:", error);
        return `Recovery failed: ${error.message}`;
    }
}
