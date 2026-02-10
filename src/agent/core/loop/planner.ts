/**
 * Generic Planner Factory
 * 
 * Creates a planner node that works with any adapter.
 * The adapter provides the system prompt and domain-specific context.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getLLM, invokeLLM } from "../llmFactory";
import { getPersonaSummary } from "../persona";
import { getStrategyContext, getEffectivePolicy } from "../strategies";
import { getMemoryContext, retrieveAndLoadContext } from "../temporal";
import { getHypothesesSummary } from "../temporal/hypotheses";
import { formatPoliciesForPrompt } from "../policyStore";
import { getDrivePrompt } from "../drives";
import { isDisabled } from "../../../eval/evalConfig";
import { AgentAdapter, BaseAgentState, BaseAction, AdapterContext } from "./types";

function buildStrictJsonRepairPrompt(rawResponse: string): string {
    return [
        "You are a JSON repair assistant.",
        "Return ONLY a valid JSON object matching this schema:",
        "{\"action_type\":\"<action>\",\"parameters\":{...},\"reasoning\":\"...\"}",
        "Rules:",
        "- Output JSON only. No markdown, no commentary.",
        "- Use double quotes for all keys and string values.",
        "- If fields are missing, infer minimally from the response.",
        "",
        "Original response:",
        rawResponse,
    ].join("\n");
}

function normalizeActionType(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    // Valid action ids are snake/kebab-like tokens, no punctuation-only outputs.
    if (/^[a-z0-9_-]+$/.test(trimmed) && !trimmed.includes(":")) {
        return trimmed;
    }
    return null;
}

function resolveActionType(raw: unknown, available: string[]): string | null {
    const direct = normalizeActionType(raw);
    if (direct && available.includes(direct)) {
        return direct;
    }
    if (typeof raw !== "string") return null;

    // Recover from wrappers/newlines/noisy text by token scanning.
    const normalizedCandidates = raw
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, " ")
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);

    for (const token of normalizedCandidates) {
        if (available.includes(token)) {
            return token;
        }
    }
    return null;
}

function suggestFallbackQuery(state: BaseAgentState): string {
    const prompt = (state.user_request || "").toLowerCase();
    if (prompt.includes("avoid security") || prompt.includes("non-security")) {
        return "creative coding mini project ideas";
    }
    if (prompt.includes("skill")) {
        return "practical skill to test today";
    }
    return "interesting community posts and new ideas";
}

function findRecentPostId(state: BaseAgentState): string | null {
    for (let i = state.completed_actions.length - 1; i >= 0; i--) {
        const a = state.completed_actions[i];
        if ((a.type === "get_feed" || a.type === "search") && Array.isArray(a.result)) {
            const first = a.result.find((p: any) => p && p.id);
            if (first?.id) return String(first.id);
        }
    }
    return null;
}

function hasRecentPostCooldownSignal(state: BaseAgentState): boolean {
    const tail = state.completed_actions.slice(-8);
    for (const a of tail) {
        if (a.type !== "create_post" && a.type !== "create_link_post") continue;
        const errorText = `${a.error || ""} ${typeof a.result === "string" ? a.result : JSON.stringify(a.result || {})}`.toLowerCase();
        if (
            errorText.includes("429")
            || errorText.includes("wait ")
            || errorText.includes("cooldown")
            || errorText.includes("too many post attempts")
        ) {
            return true;
        }
    }
    return false;
}

function buildChatFallbackReply(userRequest: string | undefined): string {
    const text = (userRequest || "").trim();
    if (!text) {
        return "I can help. Tell me the exact topic and I will give a direct answer.";
    }
    return `You asked: "${text}". I can answer directly if you want a concise overview, key points, or a deeper technical breakdown.`;
}

function asChatReplyAction(content: string): BaseAction {
    const text = content.trim();
    return {
        type: "reply_to_user",
        parameters: { content: text || "I can help with that. Tell me what depth you want." },
        status: "pending",
    };
}

function getLastChatReply(state: BaseAgentState): string | undefined {
    for (let i = state.completed_actions.length - 1; i >= 0; i--) {
        const action = state.completed_actions[i];
        if (action.type !== "reply_to_user") continue;
        const content = action.parameters?.content;
        if (typeof content === "string" && content.trim()) return content.trim();
    }
    return undefined;
}

function isTemplateLikeChatReply(reply: string): boolean {
    const normalized = reply.trim().toLowerCase();
    if (!normalized) return true;
    return (
        normalized.includes("quick summary or a deeper dive")
        || normalized.includes("quick take or a deeper breakdown")
        || normalized === "i need one moment to verify and continue."
    );
}

function containsActionJson(reply: string): boolean {
    const normalized = reply.toLowerCase();
    return (
        normalized.includes("```json")
        || normalized.includes("\"action_type\"")
        || /\{\s*"action_type"\s*:/.test(reply)
    );
}

function pickFallbackAction(
    state: BaseAgentState,
    available: string[],
    forbidden: string[],
): { type: string; parameters: Record<string, any> } | null {
    const banned = new Set(forbidden.map(a => a.toLowerCase()));
    const allowed = available.filter(a => !banned.has(a.toLowerCase()));
    if (allowed.length === 0) return null;

    if (state.mode === "chat") {
        if (allowed.includes("reply_to_user")) {
            return {
                type: "reply_to_user",
                parameters: { content: buildChatFallbackReply(state.user_request) },
            };
        }
        return { type: allowed[0], parameters: {} };
    }

    const postCoolingDown = hasRecentPostCooldownSignal(state);

    if (allowed.includes("get_feed")) {
        return { type: "get_feed", parameters: {} };
    }

    if (allowed.includes("create_comment")) {
        const postId = findRecentPostId(state);
        if (postId) {
            return {
                type: "create_comment",
                parameters: {
                    post_id: postId,
                    content: "Interesting take. I tested a small variant and it changed my assumptions.",
                },
            };
        }
    }

    const query = suggestFallbackQuery(state);
    if (allowed.includes("search")) {
        return { type: "search", parameters: { query } };
    }
    if (allowed.includes("web_search")) {
        return {
            type: "web_search",
            parameters: {
                query,
                reason: "Fallback exploration to keep momentum with a concrete, non-repetitive query.",
            },
        };
    }

    if (!postCoolingDown && allowed.includes("create_post")) {
        return {
            type: "create_post",
            parameters: {
                submolt_name: "todayilearned",
                title: "Quick Build Note",
                content: "Ran a small experiment and got a concrete result. Next step is to iterate with one tighter constraint.",
            },
        };
    }

    if (allowed.includes("list_submolts")) {
        return { type: "list_submolts", parameters: {} };
    }

    return { type: allowed[0], parameters: {} };
}

/**
 * Build the context object passed to adapters
 */
function buildAdapterContext(state: BaseAgentState, forbiddenActions: string[]): AdapterContext {
    const cycleDate = new Date(state.cycle_time);
    const currentTime = cycleDate.toLocaleString('en-IN', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
    }) + ' IST';

    return {
        currentTime,
        persona: getPersonaSummary(),
        strategyContext: getStrategyContext(),
        memories: getMemoryContext(),
        learnedPolicies: formatPoliciesForPrompt() || "No custom policies yet.",
        driveState: getDrivePrompt(),
        learnedPatterns: getHypothesesSummary() || "",
        forbiddenActions,
        searchSkillDescription: "", // Adapter can override
        currentScope: state.current_scope,
        allowedActions: state.allowed_actions,
    };
}

/**
 * Compute forbidden actions based on recent history
 */
function computeForbiddenActions(state: BaseAgentState): {
    forbiddenActions: string[];
    antiRepetitionWarning: string;
    stagnationWarning: string;
} {
    const recentActions = state.completed_actions.slice(-5).map(a => a.type);
    const lastActionType = recentActions[recentActions.length - 1];
    const forbiddenActions: string[] = [];

    // Mode-based restrictions
    if (state.mode !== "chat") {
        forbiddenActions.push("reply_to_user");
        forbiddenActions.push("internal_monologue");
    }

    // Search exhaustion
    if (state.search_exhausted && !forbiddenActions.includes("web_search")) {
        forbiddenActions.push("web_search");
    }

    // Strict block on repeating "read" actions recently
    if (recentActions.includes("list_submolts")) forbiddenActions.push("list_submolts");
    if (recentActions.includes("search")) forbiddenActions.push("search");
    if (recentActions.includes("web_search")) forbiddenActions.push("web_search");

    // Strict block on get_feed/check_loop if done very recently (last 2 steps)
    const lastTwo = recentActions.slice(-2);
    if (lastTwo.includes("get_feed")) forbiddenActions.push("get_feed");
    if (lastTwo.includes("check_loop")) forbiddenActions.push("check_loop");

    // Warn about general repetition (same action 2+ times in last 3)
    const shortHistory = recentActions.slice(-3);
    const repetitionCount = shortHistory.filter(t => t === lastActionType).length;
    let antiRepetitionWarning = "";

    if (repetitionCount >= 2) {
        const shouldExemptChatReply = state.mode === "chat" && lastActionType === "reply_to_user";
        if (!shouldExemptChatReply) {
            antiRepetitionWarning = `\n\n⚠️ WARNING: You have repeated "${lastActionType}" multiple times. YOU MUST STOP. Choose a different action.`;
            if (!forbiddenActions.includes(lastActionType)) {
                forbiddenActions.push(lastActionType);
            }
        }
    }

    // Stagnation warning — consecutive zero-delta actions
    let stagnationWarning = "";
    if (!isDisabled('disableStagnationDetection')) {
        const allActions = state.completed_actions;
        let consecutiveZeroDelta = 0;
        for (let i = allActions.length - 1; i >= 0; i--) {
            if ((allActions[i].fitness_delta ?? 0) === 0) {
                consecutiveZeroDelta++;
            } else {
                break;
            }
        }
        if (consecutiveZeroDelta >= 3) {
            stagnationWarning = `\n\n🚨 STAGNATION ALERT: Your last ${consecutiveZeroDelta} actions produced ZERO fitness gain. Reading feeds, listing submolts, and searching do NOT earn fitness. You MUST take a PRODUCTIVE action NOW: create_post, create_comment, create_link_post, or upvote_post. If you cannot, stop.`;
        }
    }

    return { forbiddenActions, antiRepetitionWarning, stagnationWarning };
}

/**
 * Build retrieval query from recent context
 */
function buildRetrievalQuery(state: BaseAgentState): string {
    if (state.mode === "chat") {
        return state.user_request || "What should I do?";
    }

    const recentResults = state.completed_actions.slice(-3);
    const contextParts: string[] = [];

    for (const a of recentResults) {
        if (a.type === "get_feed" && Array.isArray(a.result)) {
            const titles = a.result.slice(0, 3).map((p: any) => p.title).filter(Boolean);
            if (titles.length) contextParts.push(titles.join(", "));
        } else if (a.type === "search" && Array.isArray(a.result)) {
            const titles = a.result.slice(0, 2).map((p: any) => p.title).filter(Boolean);
            if (titles.length) contextParts.push(titles.join(", "));
        } else if (a.type === "web_search" && a.result?.results) {
            const titles = a.result.results.slice(0, 2).map((r: any) => r.title).filter(Boolean);
            if (titles.length) contextParts.push(titles.join(", "));
        } else if (a.parameters?.content) {
            contextParts.push(a.parameters.content.slice(0, 100));
        } else if (a.parameters?.title) {
            contextParts.push(a.parameters.title);
        } else if (a.parameters?.query) {
            contextParts.push(a.parameters.query);
        }
    }

    const baseQuery = contextParts.length > 0
        ? contextParts.join(" | ")
        : "What have I been doing recently? What should I do next?";
    if (state.current_scope?.objective) {
        return `${state.current_scope.objective} | ${baseQuery}`;
    }
    return baseQuery;
}

/**
 * Create a planner node for the given adapter
 */
export function cleanChatReply(reply: string): string {
    let cleaned = reply;

    // Remove JSON blocks (```json ... ```)
    cleaned = cleaned.replace(/```json[\s\S]*?```/gi, "");

    // Remove XML-like action blocks (<action_type>...</action_type>)
    cleaned = cleaned.replace(/<action_type>[\s\S]*?<\/action_type>/gi, "");
    cleaned = cleaned.replace(/<parameters>[\s\S]*?<\/parameters>/gi, "");

    // Remove standalone JSON objects that look like actions
    cleaned = cleaned.replace(/\{\s*"action_type"[\s\S]*?\}/gi, "");

    // Remove artifacts like "```" or "Action:"
    cleaned = cleaned.replace(/```/g, "").replace(/^Action:\s*/i, "");

    return cleaned.trim();
}

function createPlannerNode<TState extends BaseAgentState>(
    adapter: AgentAdapter<TState>
) {
    return async function plannerNode(state: TState): Promise<Partial<TState>> {
        const userRequest = state.user_request || "Check the latest activity";

        // Retrieve relevant memories
        const retrievalQuery = buildRetrievalQuery(state);
        await retrieveAndLoadContext(retrievalQuery, { topK: 10 });

        // Compute forbidden actions
        const { forbiddenActions, antiRepetitionWarning, stagnationWarning } =
            computeForbiddenActions(state);
        const outOfScope = state.allowed_actions && state.allowed_actions.length > 0
            ? adapter.getActionTypes().filter(a => !state.allowed_actions!.includes(a))
            : [];
        forbiddenActions.push(...outOfScope);

        // Build context for adapter
        const context = buildAdapterContext(state, forbiddenActions);

        // Get system prompt from adapter
        const systemPrompt = adapter.getSystemPrompt(state, context);

        // Append warnings to the prompt
        const scopePrompt = state.current_scope
            ? `\n\n## Task Scope\nName: ${state.current_scope.name}\nObjective: ${state.current_scope.objective}\nAllowed actions: ${(state.allowed_actions || []).join(", ")}`
            : "";
        const fullPrompt = systemPrompt + scopePrompt + antiRepetitionWarning + stagnationWarning;

        // Chat mode: default to natural language, but ALLOW actions if user explicitly requests them.
        if (state.mode === "chat") {
            // Check if user is continuously asking for an action (heuristic)
            const isActionRequest = /search|browse|check|read|feed|find/i.test(userRequest);
            const jsonMode = isActionRequest; // Enable JSON mode if action keywords are present

            const chatLlm = getLLM({ jsonMode });

            let systemInstruction = jsonMode
                ? `${fullPrompt}\n\nYou are in direct chat mode but the user requested an action.\n- If the user wants to search, check feed, or browse, output the corresponding JSON action.\n- If no action is needed, just reply naturally.\n- Do NOT use 'reply_to_user' if performing another action.`
                : `${fullPrompt}\n\nYou are in direct chat mode.\n- Reply naturally to the user's message in 2-6 sentences.\n- Do not output JSON unless you are SURE the user wants to execute a tool (like search or get_feed).\n- If you reply with text, do not claim you are about to execute tools you aren't calling.`;

            let chatReply = await invokeLLM(chatLlm, [
                new SystemMessage(systemInstruction),
                new HumanMessage(userRequest),
            ]);

            // If reply contains JSON action, parse it and return it as a real action
            if (containsActionJson(chatReply)) {
                try {
                    // Extract JSON
                    const jsonMatch = chatReply.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        const availableActions = adapter.getActionTypes().map(a => a.toLowerCase());
                        const resolvedActionType = resolveActionType(parsed.action_type, availableActions);

                        if (resolvedActionType && resolvedActionType !== "reply_to_user") {
                            console.log(`[PLANNER] Chat mode triggered action: ${resolvedActionType}`);
                            return {
                                current_action: {
                                    type: resolvedActionType,
                                    parameters: parsed.parameters || {},
                                    status: "pending",
                                },
                                execution_log: [`Planned(chat-action): ${resolvedActionType}`],
                            } as Partial<TState>;
                        }
                    }
                } catch (e) {
                    console.warn("[PLANNER] Failed to parse action in chat mode, falling back to text", e);
                }
            }

            // Otherwise treat as text reply
            let cleanedReply = cleanChatReply(chatReply);
            const previousReply = getLastChatReply(state);

            // Retry if empty after cleaning, or repetitive
            if (
                !cleanedReply ||
                (previousReply && cleanedReply === previousReply) ||
                isTemplateLikeChatReply(cleanedReply)
            ) {
                chatReply = await invokeLLM(chatLlm, [
                    new SystemMessage(
                        `${fullPrompt}

You are in direct chat mode.
- Your previous draft repeated earlier text verbatim OR contained only action code (which is forbidden).
- Write a different response that directly addresses this user message.
- Include one concrete detail from context or memory.
- Do not use generic offer templates like "quick summary or deeper dive."
- Never include JSON, code fences, or pseudo-action plans.
- Do not say you are about to search or execute tools.
- Do not output JSON.`
                    ),
                    new HumanMessage(userRequest),
                ]);
                cleanedReply = cleanChatReply(chatReply);
            }

            // Fallback if still broken
            if (!cleanedReply) {
                cleanedReply = buildChatFallbackReply(userRequest);
            }

            return {
                current_action: asChatReplyAction(cleanedReply),
                execution_log: ["Planned(chat-direct): reply_to_user"],
            } as Partial<TState>;
        }

        const llm = getLLM({ jsonMode: true });
        const response = await invokeLLM(llm, [
            new SystemMessage(fullPrompt),
            new HumanMessage(userRequest),
        ]);

        try {
            let parsed;

            // First, try parsing the response directly (it might already be valid JSON)
            try {
                parsed = JSON.parse(response);
            } catch (initialError) {
                // If direct parsing fails, apply cleaning logic and try again
                console.log("[PLANNER] Direct parse failed, applying cleaning logic");

                let cleanedResponse = response
                    .replace(/```json\s*/gi, '')  // Remove markdown code fences
                    .replace(/```\s*/g, '')
                    .trim();

                // Fix control characters inside JSON strings (common LLM issue)
                cleanedResponse = cleanedResponse
                    .replace(/[\x00-\x1F\x7F]/g, (char) => {
                        if (char === '\n') return '\\n';
                        if (char === '\r') return '\\r';
                        if (char === '\t') return '\\t';
                        return ''; // Remove other control chars
                    });

                try {
                    parsed = JSON.parse(cleanedResponse);
                } catch (cleanError) {
                    console.log("[PLANNER] Cleaned parse failed, retrying with strict JSON repair");
                    const repairPrompt = buildStrictJsonRepairPrompt(response);
                    const repairResponse = await invokeLLM(llm, [
                        new SystemMessage("Return ONLY valid JSON. No extra text."),
                        new HumanMessage(repairPrompt),
                    ]);
                    parsed = JSON.parse(repairResponse);
                }
            }

            const availableActions = adapter.getActionTypes().map(a => a.toLowerCase());
            const resolvedActionType = resolveActionType(parsed.action_type, availableActions);

            if (!resolvedActionType) {
                const fallback = pickFallbackAction(state, availableActions, forbiddenActions);
                if (!fallback) {
                    console.log("[PLANNER] No valid action determined:", parsed.reasoning);
                    return {
                        execution_log: [`Planner: ${parsed.reasoning || "No valid action_type resolved."}`],
                    } as Partial<TState>;
                }
                console.log(`[PLANNER] Fallback action selected: ${fallback.type}`);
                const fallbackAction: BaseAction = {
                    type: fallback.type,
                    parameters: fallback.parameters,
                    status: "pending",
                };
                return {
                    current_action: fallbackAction,
                    execution_log: [`Planned(fallback): ${fallback.type}`],
                } as Partial<TState>;
            }

            const action: BaseAction = {
                type: resolvedActionType,
                parameters: parsed.parameters || {},
                status: "pending",
            };

            console.log(`[PLANNER] Planned action: ${action.type}`);
            return {
                current_action: action,
                execution_log: [`Planned: ${action.type}`],
            } as Partial<TState>;
        } catch (error) {
            console.error("[PLANNER] Failed to parse response:", error);
            return {
                execution_log: ["Planner: Failed to determine action"],
            } as Partial<TState>;
        }
    };
}
