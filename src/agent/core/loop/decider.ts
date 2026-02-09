/**
 * Generic Decider Factory
 * 
 * Creates a decider node that validates actions before execution.
 * Uses the adapter to get required parameters and custom validation.
 */

import { AgentAdapter, BaseAgentState, BaseAction } from "./types";

/**
 * Create a decider node for the given adapter
 */
export function createDeciderNode<TState extends BaseAgentState>(
    adapter: AgentAdapter<TState>
) {
    return async function deciderNode(state: TState): Promise<Partial<TState>> {
        const action = state.current_action;
        if (!action) {
            return { current_action: null } as Partial<TState>;
        }

        // HARD BLOCK: Prevent infinite loops by rejecting repeated actions
        const recentActions = state.completed_actions.slice(-3).map(a => a.type);
        const repetitionCount = recentActions.filter(t => t === action.type).length;

        // HARD BLOCK: Scope-limited action menu
        const allowed = state.allowed_actions || [];
        if (allowed.length > 0 && !allowed.includes(action.type)) {
            console.log(`[DECIDER] ⚠️ BLOCKED: Action "${action.type}" is outside current scope.`);
            return {
                current_action: {
                    ...action,
                    status: "failed",
                    error: `Action "${action.type}" is out-of-scope. Allowed: ${allowed.join(", ")}`,
                },
                execution_log: [`decider_block:out_of_scope:${action.type}`],
            } as Partial<TState>;
        }

        const exemptChatReply = state.mode === "chat" && action.type === "reply_to_user";
        if (repetitionCount >= 3 && !exemptChatReply) {
            console.log(`[DECIDER] ⚠️ BLOCKED: Action "${action.type}" repeated ${repetitionCount} times. Forcing stop.`);
            return {
                current_action: {
                    ...action,
                    status: "failed",
                    error: `Action blocked: "${action.type}" was repeated too many times. Try a different action to make progress.`,
                },
                execution_log: [`decider_block:repetition:${action.type}`],
            } as Partial<TState>;
        }

        // Custom adapter validation
        if (adapter.validateAction) {
            const validationError = adapter.validateAction(action, state);
            if (validationError) {
                console.log(`[DECIDER] ⚠️ BLOCKED: ${validationError}`);
                return {
                    current_action: {
                        ...action,
                        status: "failed",
                        error: validationError,
                    },
                } as Partial<TState>;
            }
        }

        // Validate required parameters
        const requiredParams = adapter.getRequiredParams(action.type);
        const missingParams = requiredParams.filter(p => !action.parameters[p]);

        if (missingParams.length > 0) {
            return {
                current_action: {
                    ...action,
                    status: "failed",
                    error: `Missing required parameters: ${missingParams.join(", ")}`,
                },
            } as Partial<TState>;
        }

        // Mark as approved
        return {
            current_action: { ...action, status: "approved" },
        } as Partial<TState>;
    };
}
