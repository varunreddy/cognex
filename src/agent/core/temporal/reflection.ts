/**
 * Self-Reflection System
 * Enables the agent to analyze memories, generate insights, and evolve
 */

import { isDisabled } from '../../../eval/evalConfig.js';
import { ChatOpenAI } from '@langchain/openai';
import { ReflectionOutput, LongTermMemory } from './memoryTypes';
import {
    getRecentMemoriesFromDB,
    saveReflection,
    createMemory,
    getMetadata,
    updateMetadata,
    createLink,
    vectorSearch,
    getMemory,
} from './memoryStore';
import { loadLLMConfig } from '../llmConfig';
import { generateEmbedding } from './embedding';
import { savePolicy } from '../policyStore.js';
import { runRecoverySequence } from './recovery';

/**
 * Check if self-reflection should be triggered
 */
export function shouldReflect(interactionCount: number): {
    should: boolean;
    trigger: ReflectionOutput['trigger'];
} {
    const lastReflection = getMetadata('last_reflection');
    const lastReflectionTime = lastReflection ? new Date(lastReflection) : null;
    const currentTime = new Date();

    // Trigger 1: Every 50 interactions
    if (interactionCount > 0 && interactionCount % 50 === 0) {
        return { should: true, trigger: 'scheduled' };
    }

    // Trigger 2: Every 24 hours
    if (lastReflectionTime) {
        const hoursSinceLastReflection =
            (currentTime.getTime() - lastReflectionTime.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastReflection >= 24) {
            return { should: true, trigger: 'scheduled' };
        }
    } else {
        // Never reflected before - do it after first 10 interactions
        if (interactionCount >= 10) {
            return { should: true, trigger: 'scheduled' };
        }
    }

    return { should: false, trigger: 'manual' };
}

/**
 * Perform self-reflection on recent memories
 */
export async function performReflection(
    trigger: ReflectionOutput['trigger'] = 'manual'
): Promise<ReflectionOutput> {
    if (isDisabled('disableReflection')) {
        return { id: '', reflected_at: new Date().toISOString(), trigger, insights: [], personality_updates: {}, memories_consolidated: [], duration_ms: 0 };
    }
    const startTime = Date.now();
    console.log('[REFLECTION] Starting self-reflection session...');

    // Get recent memories for analysis
    const recentMemories = getRecentMemoriesFromDB(50);

    if (recentMemories.length === 0) {
        console.log('[REFLECTION] No memories to reflect on');
        return {
            id: '',
            reflected_at: new Date().toISOString(),
            trigger,
            insights: ['Not enough experiences to reflect on yet.'],
            personality_updates: {},
            memories_consolidated: [],
            belief_correction: undefined,
            duration_ms: Date.now() - startTime,
        };
    }

    // Generate reflection using LLM
    const { insights, personalityUpdates, beliefCorrection } = await analyzeMemories(recentMemories);

    // Consolidate similar memories
    const consolidatedIds = consolidateMemories(recentMemories);

    // Run Belief Correction if triggered
    if (beliefCorrection) {
        console.log(`[REFLECTION] Triggering Belief Correction: "${beliefCorrection}"`);
        await runRecoverySequence(beliefCorrection);
    }

    // Save reflection
    const reflectionOutput: Omit<ReflectionOutput, 'id'> = {
        reflected_at: new Date().toISOString(),
        trigger,
        insights,
        personality_updates: personalityUpdates,
        memories_consolidated: consolidatedIds,
        belief_correction: beliefCorrection,
        duration_ms: Date.now() - startTime,
    };

    const reflectionId = saveReflection(reflectionOutput);

    console.log(`[REFLECTION] Completed in ${reflectionOutput.duration_ms}ms`);
    console.log(`[REFLECTION] Generated ${insights.length} insights`);
    console.log(`[REFLECTION] Consolidated ${consolidatedIds.length} memories`);

    return { id: reflectionId, ...reflectionOutput };
}

/**
 * Analyze memories using LLM to generate insights
 */
async function analyzeMemories(
    memories: LongTermMemory[]
): Promise<{ insights: string[]; personalityUpdates: Record<string, number>; beliefCorrection?: string }> {
    const config = loadLLMConfig();
    if (!config) {
        throw new Error('LLM not configured');
    }

    const llm = new ChatOpenAI({
        apiKey: config.api_key,
        modelName: config.model,
        temperature: 0.7,
        configuration: {
            baseURL: config.base_url,
        },
    });

    // Prepare memory summary for LLM
    const memorySummary = memories
        .slice(-20) // Last 20 memories
        .map((m, idx) => {
            const age = getTimeSince(m.created_at);
            return `${idx + 1}. [${age}] (${m.type}) ${m.content}`;
        })
        .join('\n');

    const reflectionPrompt = `You are performing self-reflection on your recent experiences as an autonomous agent.

## Recent Memories (Last 20)
${memorySummary}

## Reflection Tasks
1. **Identify Patterns**: What recurring themes or behaviors do you notice?
2. **Generate Insights**: What have you learned about yourself, your environment, or effective strategies?
3. **Emotional Awareness**: How do these experiences make you feel? What emotions emerge?
4. **Growth Opportunities**: What could you improve or focus on going forward?
5. **Belief Correction**: Did you SUCCEED at something you previously thought you couldn't do? (e.g., "I thought search was broken, but I just used it successfully"). If so, identify the fixed limitation.

Respond in the following JSON format:
{
  "insights": [
    "Insight 1: I notice that...",
    "Insight 2: I've learned that...",
    "Insight 3: I feel..."
  ],
  "personality_updates": {
    "curiosity": +0.1,
    "caution": -0.05
  },
  "belief_correction": "Fixed broken API keys in environment variables" // Optional: Only if a limitation is visibly resolved
}

Note: personality_updates should be small adjustments (-0.2 to +0.2) to personality traits based on your reflection.
`;

    try {
        const response = await llm.invoke(reflectionPrompt);
        const content = typeof response.content === 'string' ? response.content : '';

        // Parse JSON response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            // Sanitize: JSON spec doesn't allow explicit plus signs for numbers (e.g. +0.1)
            // LLMs often output them when asked for adjustments. Remove them.
            const rawJson = jsonMatch[0].replace(/:\s*\+/g, ': ');

            try {
                const parsed = JSON.parse(rawJson);
                return {
                    insights: parsed.insights || [],
                    personalityUpdates: parsed.personality_updates || {},
                    beliefCorrection: parsed.belief_correction,
                };
            } catch (e) {
                // Sometmes the regex isn't enough or the JSON is just bad
                console.warn("[REFLECTION] JSON parse failed even after sanitization:", e);
                return {
                    insights: [content], // Fallback to raw content as insight
                    personalityUpdates: {},
                    beliefCorrection: undefined,
                };
            }
        }

        // Fallback: treat entire response as single insight
        return {
            insights: [content],
            personalityUpdates: {},
            beliefCorrection: undefined,
        };
    } catch (error: any) {
        console.error('[REFLECTION] LLM analysis failed:', error.message);
        return {
            insights: ['Reflection analysis unavailable'],
            personalityUpdates: {},
            beliefCorrection: undefined,
        };
    }
}

/**
 * Consolidate similar memories by creating links and semantic memories
 */
function consolidateMemories(memories: LongTermMemory[]): string[] {
    const consolidated: string[] = [];
    const currentTime = new Date().toISOString();

    // Group memories by type
    const episodic = memories.filter(m => m.type === 'episodic');

    // Find clusters of related episodic memories (simple heuristic: same tags)
    const tagClusters = new Map<string, LongTermMemory[]>();

    for (const memory of episodic) {
        for (const tag of memory.tags) {
            if (!tagClusters.has(tag)) {
                tagClusters.set(tag, []);
            }
            tagClusters.get(tag)!.push(memory);
        }
    }

    // Create links between memories in the same cluster
    for (const [tag, cluster] of tagClusters) {
        if (cluster.length < 2) continue;

        // Link each memory to others in cluster
        for (let i = 0; i < cluster.length - 1; i++) {
            for (let j = i + 1; j < cluster.length; j++) {
                const linkId = createLink({
                    from_memory_id: cluster[i].id,
                    to_memory_id: cluster[j].id,
                    weight: 0.5, // Initial weight for thematic links
                    link_type: 'semantic',
                    created_at: currentTime,
                    last_updated: currentTime,
                    co_retrieval_count: 0,
                    initial_similarity: 0.5,
                });

                consolidated.push(linkId);
            }
        }
    }

    return consolidated;
}

/**
 * Save insights as new semantic memories
 */
/**
 * Save insights as new semantic memories (with Promotion Gating)
 */
export async function saveInsightsAsMemories(insights: string[]): Promise<void> {
    for (const insight of insights) {
        const embedding = await generateEmbedding(insight);

        // --- SEMANTIC PROMOTION GATING ---
        // Require evidence before promoting to semantic memory
        // Search for episodic memories that support this insight
        const supportingMemories = vectorSearch(embedding, 10);
        const relevantEvidence = supportingMemories.filter(m => m.distance < 0.4); // <0.4 distance = >0.6 similarity

        if (relevantEvidence.length < 2) {
            console.log(`[REFLECTION] Insight rejected (not enough evidence): "${insight.substring(0, 50)}..."`);
            continue;
        }

        console.log(`[REFLECTION] Insight promoted (${relevantEvidence.length} supports): "${insight.substring(0, 50)}..."`);

        createMemory({
            created_at: new Date().toISOString(),
            content: insight,
            embedding,
            type: 'semantic',
            importance: 0.8, // Insights are important
            arousal: 0.1,    // Reflective insights are calm/analytical
            tags: ['self_reflection', 'insight'],
            source: 'self_reflection',
            base_decay_rate: 0.02, // Decay slower (important knowledge)
        });

        // --- POLICY EXTRACTION (Procedural Memory) ---
        // Ask LLM if this insight implies a rule
        await extractPolicyFromInsight(insight);
    }

    // console.log(`[REFLECTION] Processing complete.`);
}

async function extractPolicyFromInsight(insight: string): Promise<void> {
    const config = loadLLMConfig();
    if (!config) return;

    const llm = new ChatOpenAI({
        apiKey: config.api_key,
        modelName: config.model,
        temperature: 0.3, // Lower temp for logic/rules
        configuration: { baseURL: config.base_url },
    });

    const prompt = `
You are the "Superego" of an AI agent. You have just realized this insight about yourself/world:
"${insight}"

Does this insight imply a STRICT BEHAVIORAL RULE (Policy) you should follow in the future?
Policies must be actionable instructions, not just observations.

Examples:
- Insight: "I get downvoted when I'm rude." -> Policy: "When creating comments, always use a polite tone."
- Insight: "People like it when I cite sources." -> Policy: "When making a claim, always provide a source link."
- Insight: "I feel lonely." -> NO POLICY (Internal feeling).

If YES, return a JSON:
{
  "has_policy": true,
  "trigger": "When [situation]",
  "rule": "[Actionable instruction]",
  "confidence": 0.9
}

If NO (or confidence < 0.8), return:
{ "has_policy": false }
`;

    try {
        const response = await llm.invoke(prompt);
        const content = typeof response.content === 'string' ? response.content : '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            if (result.has_policy && result.confidence >= 0.8) {
                savePolicy({
                    trigger: result.trigger,
                    rule: result.rule,
                    source_insight: insight,
                    confidence: result.confidence
                });
            }
        }
    } catch (e) {
        console.warn("[REFLECTION] Policy extraction failed:", e);
    }
}

/**
 * Increment interaction counter
 */
export function incrementInteractionCount(): number {
    const currentCount = parseInt(getMetadata('interaction_count') || '0', 10);
    const newCount = currentCount + 1;
    updateMetadata('interaction_count', newCount.toString());
    return newCount;
}

/**
 * Get current interaction count
 */
export function getInteractionCount(): number {
    return parseInt(getMetadata('interaction_count') || '0', 10);
}

/**
 * Helper: Get human-readable time since timestamp
 */
function getTimeSince(timestamp: string): string {
    const past = new Date(timestamp);
    const now = new Date();
    const ageMs = now.getTime() - past.getTime();

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
