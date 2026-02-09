/**
 * Moltbook Agent Nodes
 * 
 * LangGraph nodes for the Moltbook agent.
 * This is a thin wrapper that uses the core loop factories with the Moltbook adapter.
 */

import { AgentState, MoltbookAction, Skill } from "./types.js";
import { createScopeSelectorNode, createPlannerNode, createDeciderNode, createExecutorNode } from "../../src/agent/core/loop/index.js";
import { moltbookAdapter } from "./adapter.js";
import { loadMoltbookConfig } from "./moltbookConfig.js";
import { loadLoopState } from "./rateLimit.js";
import { checkAndPerformReflection } from "../../src/agent/core/temporal/index.js";

// Adapter-local stubs
function fetchAllSkills(): Promise<any[]> { return Promise.resolve([]); }

// --- Skill Loader Node ---

export async function skillLoaderNode(state: AgentState): Promise<Partial<AgentState>> {
    const skills = await fetchAllSkills();
    const credentials = loadMoltbookConfig() ?? undefined;
    const loopState = loadLoopState();

    return {
        skills,
        credentials,
        loop_state: loopState,
        execution_log: [`Loaded ${skills.length} skill(s)`],
    };
}

// --- Core Loop Nodes (via factories) ---

// Planner node created from factory with Moltbook adapter
export const scopeSelectorNode = createScopeSelectorNode(moltbookAdapter);

// Planner node created from factory with Moltbook adapter
export const plannerNode = createPlannerNode(moltbookAdapter);

// Decider node created from factory with Moltbook adapter
export const deciderNode = createDeciderNode(moltbookAdapter);

// Executor node created from factory with Moltbook adapter
export const executorNode = createExecutorNode(moltbookAdapter);

// --- Rate Limiter Node ---
// (Moltbook-specific, bypasses in chat mode)

import { checkRateLimit } from "./rateLimit.js";

export async function rateLimiterNode(state: AgentState): Promise<Partial<AgentState>> {
    const action = state.current_action;
    if (!action || action.status !== "approved") {
        return {};
    }

    // Bypass in chat mode
    if (state.mode === "chat") {
        console.log("[RATE_LIMITER] Bypassing limits for Chat Mode");
        return {};
    }

    const check = checkRateLimit(action.type);

    if (!check.allowed) {
        console.log(`[RATE_LIMITER] Blocked: ${check.reason}`);
        return {
            current_action: {
                ...action,
                status: "rate_limited",
                error: check.reason,
                retryAfter: check.retryAfterSeconds,
            },
        };
    }

    return {};
}

// --- Finalizer Node ---

export async function finalizerNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("[FINALIZER] Summarizing results...");

    const completedActions = state.completed_actions;
    const failedAction = state.current_action?.status === "failed" ? state.current_action : null;
    const rateLimitedAction = state.current_action?.status === "rate_limited" ? state.current_action : null;

    let status: "success" | "partial" | "failed" | "rate_limited" = "success";
    let summaryText = "";

    if (failedAction) {
        status = completedActions.length > 0 ? "partial" : "failed";
        summaryText = `Failed: ${failedAction.error}`;
    } else if (rateLimitedAction) {
        status = "rate_limited";
        summaryText = `Rate limited: ${rateLimitedAction.error}`;
        if (rateLimitedAction.retryAfter) {
            summaryText += ` (retry in ${rateLimitedAction.retryAfter}s)`;
        }
    } else if (completedActions.length === 0) {
        status = "failed";
        summaryText = "No actions were executed";
    } else {
        const lastAction = completedActions[completedActions.length - 1];
        summaryText = formatActionResult(lastAction);
    }

    // Check if self-reflection should be triggered
    try {
        const reflected = await checkAndPerformReflection();
        if (reflected) {
            console.log("[FINALIZER] Self-reflection completed - memories consolidated");
        }
    } catch (e) {
        console.warn("[FINALIZER] Reflection check failed:", e);
    }

    return {
        summary: {
            summary_text: summaryText,
            actions_taken: completedActions,
            status,
        },
    };
}

// --- Helper Functions ---

function formatActionResult(action: MoltbookAction): string {
    const { type, result } = action;

    if (!result) return `Completed: ${type}`;

    switch (type) {
        case "check_claim_status":
            return `Claim status: ${result.status}`;
        case "get_feed":
        case "check_loop":
            if (Array.isArray(result)) {
                return `Found ${result.length} posts in feed`;
            }
            return "Checked feed";
        case "create_post":
        case "create_link_post":
            return `Created post: "${result.title}"`;
        case "create_comment":
            return `Added comment on post`;
        case "search":
            if (Array.isArray(result)) {
                return `Search returned ${result.length} results`;
            }
            return "Search completed";
        case "get_profile":
            return `Profile: ${result.handle} (${result.karma} karma)`;
        case "install_skill":
            return `Installed skill: ${action.parameters.skill_name}`;
        case "run_skill_command":
            return `Executed command: ${action.parameters.command}`;
        default:
            return `Completed: ${type}`;
    }
}
