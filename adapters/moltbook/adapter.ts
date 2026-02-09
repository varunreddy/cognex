/**
 * Moltbook Adapter
 * 
 * Implements AgentAdapter for the Moltbook social platform.
 * Provides Moltbook-specific actions, prompts, and validation.
 */

import { exec } from "child_process";
import * as path from "path";
import { promisify } from "util";
const execAsync = promisify(exec);

import { AgentAdapter, BaseAction, AdapterContext } from "../../src/agent/core/loop/types";
import { MOLTBOOK_SYSTEM_PROMPT, formatInstalledSkills, formatActionHistory } from "./prompts";
import { AgentState, MoltbookAction, MoltbookActionType, Skill, MoltbookCredentials } from "./types";
import * as actions from "./actions";
import { saveMemory, recordInteraction as recordMemoryInteraction, retrieveAndLoadContext } from "../../src/agent/core/temporal";
import { recordInteraction, addEvolutionNote, evolvePersonaFromFitness } from "../../src/agent/core/persona";
import { checkRateLimit, recordAction, getEngagedIds, recordEngagement, setSuspension } from "./rateLimit.js";

// Search skill (wired to real implementation)
import {
    executeSearchSkill,
    getSearchSkillDescription
} from "../search/searchSkill.js";

/**
 * Execute action internally by mapping to specific handler
 */
async function executeActionInternal(
    action: BaseAction,
    state: AgentState,
    adapter: AgentAdapter<AgentState>
): Promise<any> {
    const { type, parameters } = action;

    switch (type) {
        // --- Core Interactions ---
        case "reply_to_user":
            return {
                success: true,
                message: "Replied to user",
                content: parameters.content
            };

        case "internal_monologue":
            return {
                success: true,
                message: "Internal monologue recorded",
                thoughts: parameters.thoughts
            };

        case "check_loop":
            return { success: true, status: "alive", timestamp: Date.now() };

        // --- Moltbook API Actions ---

        case "check_claim_status":
            return await actions.checkClaimStatus();

        case "get_profile":
            return await actions.getProfile(parameters.handle);

        case "update_profile":
            return await actions.updateProfile(parameters);

        case "get_feed":
            return await actions.getFeed(parameters);

        case "create_post":
            return await actions.createPost(
                parameters.submolt_name,
                parameters.title,
                parameters.content
            );

        case "create_link_post":
            return await actions.createLinkPost(
                parameters.submolt_name,
                parameters.title,
                parameters.url
            );

        case "create_comment":
            return await actions.createComment(
                parameters.post_id,
                parameters.content
            );

        case "reply_comment":
            return await actions.replyToComment(
                parameters.post_id,
                parameters.parent_id,
                parameters.content
            );

        case "upvote_post":
            return await actions.upvotePost(parameters.post_id);

        case "downvote_post":
            return await actions.downvotePost(parameters.post_id);

        case "upvote_comment":
            return await actions.upvoteComment(parameters.comment_id);

        case "get_post":
            return await actions.getPost(parameters.post_id);

        case "get_comments":
            return await actions.getComments(parameters.post_id);

        case "delete_post":
            return await actions.deletePost(parameters.post_id);

        case "subscribe":
            return await actions.subscribe(parameters.submolt_name);

        case "unsubscribe":
            return await actions.unsubscribe(parameters.submolt_name);

        case "get_submolt":
            return await actions.getSubmolt(parameters.submolt_name);

        case "list_submolts":
            return await actions.listSubmolts();

        case "follow":
            return await actions.follow(parameters.handle);

        case "unfollow":
            return await actions.unfollow(parameters.handle);

        case "search":
            return await actions.search(parameters.query, parameters);

        // --- Skills & Tools ---

        case "web_search":
            return await executeSearchSkill({ query: parameters.query });

        case "save_memory":
            try {
                await saveMemory({
                    content: parameters.content,
                    type: 'episodic',
                    importance: 0.5,
                    tags: ['manual_save'],
                    source: 'autonomous_exploration'
                });
                return { success: true, message: "Memory saved" };
            } catch (e: any) {
                return { success: false, error: e.message };
            }

        case "run_skill_command":
            if (!parameters.command) {
                throw new Error("Command is required for run_skill_command");
            }
            // Execute shell command
            // Note: execAsync is imported at the top of the file
            const { stdout, stderr } = await execAsync(parameters.command);
            return {
                success: true,
                stdout: stdout,
                stderr: stderr
            };

        case "install_skill":
        case "inspect_skill":
            return { success: false, message: "Skill management actions not fully implemented in adapter shim." };

        default:
            throw new Error(`Unknown action type: ${type}`);
    }
}

/**
 * Moltbook Adapter implements AgentAdapter for Moltbook social platform.
 */
export const moltbookAdapter: AgentAdapter<AgentState> = {
    name: "moltbook",

    getActionTypes(): string[] {
        return [
            "reply_to_user",
            "internal_monologue",
            "check_claim_status",
            "get_feed",
            "create_post",
            "create_link_post",
            "create_comment",
            "reply_comment",
            "get_post",
            "get_comments",
            "delete_post",
            "upvote_post",
            "downvote_post",
            "upvote_comment",
            "subscribe",
            "unsubscribe",
            "get_submolt",
            "list_submolts",
            "follow",
            "unfollow",
            "get_profile",
            "update_profile",
            "search",
            "web_search",
            "check_loop",
            "save_memory",
            "install_skill",
            "inspect_skill",
            "run_skill_command",
        ];
    },

    getSystemPrompt(state: AgentState, context: AdapterContext): string {
        const agentName = state.credentials?.agent_name || "Agent";
        const engagedPostIds = getEngagedIds();

        // Format history with engagement tracking
        const history = formatActionHistory(state.completed_actions, engagedPostIds);

        // Format forbidden actions
        const forbiddenActionsText = context.forbiddenActions.length > 0
            ? `⛔ THE FOLLOWING ACTIONS ARE BANNED FOR THIS TURN: ${context.forbiddenActions.join(", ")}. DO NOT USE THEM.`
            : "None.";

        // Check rate limits for critical actions
        const postCheck = checkRateLimit("create_post");
        const commentCheck = checkRateLimit("create_comment");

        let constraints = "";
        if (!postCheck.allowed) {
            constraints += `\n⛔ CRITICAL: POSTING IS FORBIDDEN. ${postCheck.reason}. You MUST NOT use 'create_post'.`;
        }
        if (!commentCheck.allowed) {
            constraints += `\n⛔ CRITICAL: COMMENTING IS FORBIDDEN. ${commentCheck.reason}. You MUST NOT use 'create_comment' or 'reply_comment'.`;
        }

        // Determine mode context
        let modeContext = "Living Autonomously. Moltbook is your main interface.";
        if (state.mode === "chat") {
            modeContext = "Direct Chat Interaction. You are speaking 1-on-1 with a user. Prioritize 'reply_to_user'.";
        }

        return MOLTBOOK_SYSTEM_PROMPT
            .replace("{agent_name}", agentName)
            .replace("{current_time}", context.currentTime)
            .replace(/{current_year}/g, new Date().getFullYear().toString())
            .replace("{mode_context}", modeContext)
            .replace("{persona}", context.persona + "\n\n## Current Strategy\n" + context.strategyContext + (context.learnedPatterns ? "\n\n" + context.learnedPatterns : ""))
            .replace("{memories}", context.memories)
            .replace("{history}", history)
            .replace("{task_scope}", context.currentScope
                ? `${context.currentScope.name}: ${context.currentScope.objective}`
                : "No explicit scope selected for this cycle.")
            .replace("{scope_actions}", context.allowedActions && context.allowedActions.length > 0
                ? context.allowedActions.join(", ")
                : "All actions allowed.")
            .replace("{drive_state}", context.driveState)
            .replace("{learned_policies}", context.learnedPolicies)
            .replace("{forbidden_actions}", forbiddenActionsText + constraints)
            .replace("{search_skill_description}", getSearchSkillDescription())
            .replace("{installed_skills}", formatInstalledSkills(state.skills));
    },

    getRequiredParams(actionType: string): string[] {
        switch (actionType as MoltbookActionType) {
            case "reply_to_user":
                return ["content"];
            case "internal_monologue":
                return ["thoughts"];
            case "create_post":
                return ["submolt_name", "title", "content"];
            case "create_link_post":
                return ["submolt_name", "title", "url"];
            case "create_comment":
                return ["post_id", "content"];
            case "reply_comment":
                return ["post_id", "parent_id", "content"];
            case "upvote_post":
            case "downvote_post":
            case "get_post":
            case "delete_post":
                return ["post_id"];
            case "upvote_comment":
                return ["comment_id"];
            case "subscribe":
            case "unsubscribe":
            case "get_submolt":
                return ["submolt_name"];
            case "follow":
            case "unfollow":
            case "get_profile":
                return ["handle"];
            case "search":
                return ["query"];
            case "web_search":
                return ["query"];
            case "install_skill":
                return ["repo_url", "skill_name"];
            case "run_skill_command":
                return ["skill_name", "command"];
            default:
                return [];
        }
    },

    validateAction(action: BaseAction, state: AgentState): string | null {
        // Check credentials for authenticated actions
        if (action.type !== "check_loop" && action.type !== "web_search" && !state.credentials?.api_key) {
            return "Not registered. Please register first.";
        }

        // Duplicate engagement check
        if ((action.type === "create_comment" || action.type === "upvote_post") && action.parameters.post_id) {
            const targetId = String(action.parameters.post_id);
            const alreadyEngaged = state.completed_actions.some(a =>
                (a.type === "create_comment" || a.type === "upvote_post") &&
                String(a.parameters.post_id) === targetId
            );
            if (alreadyEngaged) {
                return `Already engaged with post ${targetId}. Find something else.`;
            }
        }

        return null;
    },

    async executeAction(action: BaseAction, state: AgentState): Promise<any> {
        try {
            return await executeActionInternal(action, state, this);
        } catch (error: any) {
            const msg = error.message?.toLowerCase() || "";
            if (msg.includes("suspended")) {
                console.warn(`[MOLTBOOK] Detected suspension: ${error.message}`);

                // Parse duration "ends in X hours"
                let hours = 24;
                const match = msg.match(/ends in (\d+) hours/);
                if (match) {
                    hours = parseInt(match[1], 10);
                }

                // Add some buffer (e.g. 10 mins)
                const until = Date.now() + (hours * 60 * 60 * 1000) + (10 * 60 * 1000);
                setSuspension(until);
            }
            throw error;
        }
    },

    async onActionComplete(action: BaseAction, result: any, state: AgentState): Promise<void> {
        // Record action for rate limiting
        recordAction(action.type, state.mode);

        // Record engagement
        if ((action.type === "create_comment" || action.type === "upvote_post") && action.parameters.post_id) {
            recordEngagement(String(action.parameters.post_id), action.type === "create_comment" ? "comment" : "upvote");
            console.log(`[PERSISTENCE] Saved engagement for post ${action.parameters.post_id}`);
        }

        // Save chat interactions as episodic memories
        if (action.type === "reply_to_user" && state.mode === "chat") {
            const memoryContent = `[Chat Interaction] User: "${state.user_request}" | Agent: "${action.parameters.content}"`;
            await saveMemory({
                content: memoryContent,
                type: 'episodic',
                importance: 0.8,
                tags: ['chat', 'interaction', 'user_reply']
            }).catch(e => {
                console.warn("[MEMORY] Failed to save chat:", e);
                return "";
            });
            // Ensure latest chat exchange is immediately available in working context.
            await retrieveAndLoadContext(memoryContent, { topK: 1, useSpreadingActivation: false }).catch(
                e => console.warn("[MEMORY] Failed to prime STM with chat exchange:", e)
            );
        }

        // Track persona evolution for social interactions
        evolvePersonaFromAction(action, result);
    }
};

/**
 * Evolve persona based on action
 */
function evolvePersonaFromAction(action: BaseAction, result: any): void {
    const { type, parameters: p } = action;

    try {
        if (type === "create_post") {
            addEvolutionNote(`Posted about: ${p.title} in m/${p.submolt_name}`);
        } else if (type === "create_comment" || type === "reply_comment") {
            const author = result?.author || "unknown";
            recordInteraction(author, `Commented with ${p.content?.length || 0} chars`);
        } else if (type === "upvote_post" || type === "upvote_comment") {
            addEvolutionNote(`Supported post/comment ${p.post_id || p.comment_id}`);
        } else if (type === "subscribe") {
            addEvolutionNote(`Joined community: m/${p.submolt_name}`);
        } else if (type === "follow") {
            recordInteraction(p.handle, "Followed");
        }
    } catch (e) {
        console.warn("[PERSONA] Evolution tracking failed:", e);
    }
}
