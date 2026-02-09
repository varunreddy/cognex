/**
 * Generic Executor Factory
 * 
 * Creates an executor node that runs actions via the adapter.
 * Handles fitness tracking, memory saving, and outcome logging.
 */

import { getActiveStrategy, getEffectivePolicy, recordStrategyAction } from "../strategies";
import { loadFitness, updateFitness } from "../fitness";
import { logOutcome, OutcomeRecord } from "../outcomeLogger";
import { updateDrives } from "../drives";
import { saveMemory, recordInteraction as recordMemoryInteraction } from "../temporal";
import { processOutcome } from "../temporal/hypotheses";
import { evolvePersonaFromFitness, syncPersonaWithPolicy } from "../persona";
import { analyzeDrift } from "../driftTracker";
import { shouldTakePeriodicSnapshot, createSnapshot } from "../snapshots";
import { getEvalConfig } from "../../../eval/evalConfig";
import { AgentAdapter, BaseAgentState, BaseAction } from "./types";

/**
 * Detect humor in content (simple heuristic)
 */
function detectHumor(content?: string): boolean {
    if (!content) return false;
    const humorIndicators = [
        /lol|lmao|rofl|haha|😂|🤣|😆/i,
        /joke|funny|hilarious|comedy/i,
        /\bpun\b|wordplay/i,
    ];
    return humorIndicators.some(pattern => pattern.test(content));
}

/**
 * Extract topic from action/result
 */
function extractTopic(action: BaseAction, result: any): string | undefined {
    if (action.parameters.content) {
        const words = action.parameters.content.toLowerCase().split(/\s+/);
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'it']);
        const keywords = words.filter((w: string) => w.length > 3 && !stopWords.has(w));
        return keywords.slice(0, 3).join(' ') || undefined;
    }
    if (result?.title) {
        return result.title.slice(0, 50);
    }
    return undefined;
}

/**
 * Create an executor node for the given adapter
 */
export function createExecutorNode<TState extends BaseAgentState>(
    adapter: AgentAdapter<TState>
) {
    return async function executorNode(state: TState): Promise<Partial<TState>> {
        const action = state.current_action;

        // Safety check
        if (!action) return {} as Partial<TState>;

        // If action was blocked/failed upstream, archive it and move on
        if (action.status === "failed" || action.status === "rate_limited") {
            console.log(`[EXECUTOR] Archiving blocked action: ${action.type} (${action.status})`);
            return {
                current_action: null,
                completed_actions: [...state.completed_actions, { ...action, fitness_delta: 0 }],
                execution_log: [`Blocked: ${action.type} (${action.status})`],
                step_count: state.step_count + 1,
            } as Partial<TState>;
        }

        if (action.status !== "approved") {
            return {} as Partial<TState>;
        }

        const strategy = getActiveStrategy();
        const fitnessBefore = loadFitness().overall_fitness;

        try {
            // Execute action via adapter (or mock in eval mode)
            let result: any;
            if (getEvalConfig().useMockApi) {
                const { mockExecuteAction } = await import("../../../eval/mockActions.js");
                result = await mockExecuteAction(action as any, (state as any).skills || []);
            } else {
                result = await adapter.executeAction(action, state);
            }

            // Detect search rate limit exhaustion
            let searchExhausted = state.search_exhausted || false;
            if (action.type === "web_search" && result && result.success === false) {
                const errMsg = String(result.error || result.message || "").toLowerCase();
                if (errMsg.includes("rate limit") || errMsg.includes("rate_limit") || errMsg.includes("too many requests")) {
                    searchExhausted = true;
                    console.log("[EXECUTOR] Search rate limit exhausted for remainder of run.");
                }
            }

            // Adapter-specific post-execution hook
            if (adapter.onActionComplete) {
                await adapter.onActionComplete(action, result, state);
            }

            // --- EVOLUTIONARY TRACKING ---

            const outcome: OutcomeRecord = {
                action: action.type,
                timestamp: new Date().toISOString(),
                context: {
                    topic: action.parameters.topic || extractTopic(action, result),
                    submolt: action.parameters.submolt,
                    post_id: action.parameters.post_id,
                    parent_author: result?.author,
                    content_length: action.parameters.content?.length,
                    strategy: strategy.name,
                },
                outcomes: {
                    replies: result?.reply_count || 0,
                    upvotes: result?.score || result?.upvotes || 0,
                    moderation_flag: result?.removed || false,
                },
                active_strategy: strategy.name,
                policy_params: getEffectivePolicy(),
            };
            logOutcome(outcome);

            // Update fitness scores
            const fitnessResult = updateFitness({
                action: action.type,
                upvotes: outcome.outcomes.upvotes,
                replies: outcome.outcomes.replies,
                moderation_flag: outcome.outcomes.moderation_flag,
                topic: outcome.context.topic,
                channel: outcome.context.submolt,
                interacted_with: outcome.context.parent_author,
                post_id: outcome.context.post_id,
            });

            // Update drives
            updateDrives(action.type);

            // Record strategy performance
            const fitnessEarned = fitnessResult.overall_fitness - fitnessBefore;
            recordStrategyAction(fitnessEarned);

            // Evolve persona based on fitness outcomes
            evolvePersonaFromFitness({
                action: action.type,
                success: true,
                replies: outcome.outcomes.replies,
                upvotes: outcome.outcomes.upvotes,
                moderation_flag: outcome.outcomes.moderation_flag,
                topic: outcome.context.topic,
                humor_detected: detectHumor(action.parameters.content),
                debate_engaged: action.type === "create_comment",
            });

            // Update hypothesis learning
            try {
                processOutcome({
                    action_type: action.type,
                    success: (outcome.outcomes.upvotes ?? 0) > 0 || (outcome.outcomes.replies ?? 0) > 0,
                    upvotes: outcome.outcomes.upvotes,
                    replies: outcome.outcomes.replies,
                    moderation_flag: outcome.outcomes.moderation_flag,
                    context: {
                        submolt: action.parameters.submolt_name,
                        topic: outcome.context.topic,
                        has_humor: detectHumor(action.parameters.content),
                    },
                });
            } catch (e) {
                console.warn("[HYPOTHESIS] Failed to process outcome:", e);
            }

            // Periodically sync persona with policy
            const policy = getEffectivePolicy();
            if (fitnessResult.total_actions % 10 === 0) {
                syncPersonaWithPolicy({
                    tone: policy.tone,
                    risk_tolerance: policy.risk_tolerance,
                    humor_level: policy.humor_level,
                    argument_intensity: policy.argument_intensity,
                });
            }

            // Analyze drift
            analyzeDrift();

            // Periodic snapshot
            if (shouldTakePeriodicSnapshot()) {
                createSnapshot("periodic");
            }

            console.log(`[EXECUTOR] Fitness: ${fitnessResult.overall_fitness.toFixed(1)} (Δ${fitnessEarned >= 0 ? "+" : ""}${fitnessEarned.toFixed(2)})`);

            // Auto-save significant interactions to temporal memory
            if (["create_post", "create_comment", "reply_comment"].includes(action.type)) {
                try {
                    const memoryContent = action.type === "create_post"
                        ? `Posted "${action.parameters.title}" in m/${action.parameters.submolt_name}`
                        : `Commented on post: "${action.parameters.content?.slice(0, 100)}..."`;

                    await saveMemory({
                        content: memoryContent,
                        type: 'episodic',
                        importance: 0.6,
                        tags: ['interaction', action.type, action.parameters.submolt_name].filter(Boolean),
                        source: 'autonomous_exploration',
                    });
                    console.log(`[MEMORY] Auto-saved: ${action.type}`);
                } catch (e) {
                    console.warn("[MEMORY] Auto-save failed:", e);
                }
            }

            // Record interaction for reflection triggers
            recordMemoryInteraction();

            const completedAction: BaseAction = {
                ...action,
                status: "executed",
                result,
                fitness_delta: fitnessEarned,
            };

            return {
                current_action: null,
                completed_actions: [...state.completed_actions, completedAction],
                execution_log: [`Executed: ${action.type}`],
                step_count: state.step_count + 1,
                search_exhausted: searchExhausted,
            } as Partial<TState>;

        } catch (error: any) {
            console.error("[EXECUTOR] Action failed:", error);

            logOutcome({
                action: action.type,
                timestamp: new Date().toISOString(),
                context: {
                    strategy: strategy.name,
                },
                outcomes: {
                    moderation_flag: true,
                },
                active_strategy: strategy.name,
            });

            return {
                current_action: {
                    ...action,
                    status: "failed",
                    error: error.message,
                },
                step_count: state.step_count + 1,
            } as Partial<TState>;
        }
    };
}
