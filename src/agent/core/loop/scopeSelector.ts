import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getLLM, invokeLLM } from "../llmFactory";
import { AgentAdapter, BaseAgentState, TaskScopeDecision } from "./types";

function buildSelectorPrompt(actions: string[]): string {
    return [
        "Select a cycle-level task scope for this agent run.",
        "Return JSON only.",
        "Schema:",
        "{\"name\":\"<scope>\",\"objective\":\"<one sentence>\",\"allowed_actions\":[\"a\",\"b\"],\"exit\":false}",
        "Rules:",
        "- allowed_actions MUST be a subset of available actions.",
        "- Keep allowed_actions small (2-5 actions).",
        "- Prefer actions that can be executed immediately without unknown IDs/handles.",
        "- Avoid actions like get_profile/get_post/get_comments/upvote_* unless required identifiers are known.",
        "- If no meaningful action is possible, set exit=true with objective explaining why.",
        `Available actions: ${actions.join(", ")}`,
    ].join("\n");
}

function fallbackScope(actions: string[]): TaskScopeDecision {
    return {
        name: "generic",
        objective: "Do one meaningful action and avoid repetitive browsing loops.",
        allowed_actions: actions,
        exit: false,
    };
}

function buildSafeAllowedActions(
    state: BaseAgentState,
    availableActions: string[],
    selected: string[]
): string[] {
    const loopSafePriority = [
        "web_search",
        "search",
        "get_feed",
        "list_submolts",
        "create_post",
        "create_comment",
    ].filter(a => availableActions.includes(a));

    // In non-chat modes, do not allow chat-only actions.
    const base = selected.filter(a =>
        state.mode === "chat" || (a !== "reply_to_user" && a !== "internal_monologue")
    );

    const merged = [...new Set([...base, ...loopSafePriority])];
    return merged.slice(0, 6);
}

export function createScopeSelectorNode<TState extends BaseAgentState>(
    adapter: AgentAdapter<TState>
) {
    return async function scopeSelectorNode(state: TState): Promise<Partial<TState>> {
        const availableActions = adapter.getActionTypes();
        if (state.mode === "chat") {
            const chatScope: TaskScopeDecision = {
                name: "chat-reply",
                objective: "Reply directly to the user.",
                allowed_actions: ["reply_to_user"],
                exit: false,
            };
            return {
                current_scope: chatScope,
                allowed_actions: chatScope.allowed_actions,
                execution_log: [`Scope: ${chatScope.name}`],
            } as Partial<TState>;
        }

        const llm = getLLM({ jsonMode: true });
        const userContext = state.user_request || "Autonomous cycle";
        const history = state.completed_actions.slice(-5).map(a => a.type).join(", ") || "none";
        const selectorPrompt = buildSelectorPrompt(availableActions);

        try {
            const response = await invokeLLM(llm, [
                new SystemMessage(selectorPrompt),
                new HumanMessage(`User context: ${userContext}\nRecent actions: ${history}`),
            ]);

            const parsed = JSON.parse(response) as TaskScopeDecision;
            const allowedRaw = Array.isArray(parsed.allowed_actions)
                ? parsed.allowed_actions.filter(a => availableActions.includes(a))
                : [];
            const allowed = buildSafeAllowedActions(state, availableActions, allowedRaw);

            if (!parsed.name || !parsed.objective || allowed.length === 0) {
                const fb = fallbackScope(availableActions);
                const fbAllowed = buildSafeAllowedActions(state, availableActions, fb.allowed_actions);
                return {
                    current_scope: { ...fb, allowed_actions: fbAllowed },
                    allowed_actions: fbAllowed,
                    execution_log: ["scope_parse_fail:invalid_decision", `Scope fallback: ${fb.name}`],
                } as Partial<TState>;
            }

            const decision: TaskScopeDecision = {
                name: parsed.name,
                objective: parsed.objective,
                allowed_actions: allowed,
                exit: !!parsed.exit,
            };
            console.log(`[SCOPE] ${decision.name} -> ${decision.allowed_actions.join(", ")}`);
            return {
                current_scope: decision,
                allowed_actions: decision.allowed_actions,
                execution_log: [`Scope: ${decision.name}`],
            } as Partial<TState>;
        } catch (e) {
            console.warn("[SCOPE] Selector failed, using fallback scope:", e);
            const fb = fallbackScope(availableActions);
            const fbAllowed = buildSafeAllowedActions(state, availableActions, fb.allowed_actions);
            return {
                current_scope: { ...fb, allowed_actions: fbAllowed },
                allowed_actions: fbAllowed,
                execution_log: ["scope_parse_fail:json_or_llm_error", `Scope fallback: ${fb.name}`],
            } as Partial<TState>;
        }
    };
}
