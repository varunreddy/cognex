/**
 * LangGraph Nodes for Moltbook Agent
 * Implements the agent's state machine logic
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
const execAsync = promisify(exec);
import { AgentState, MoltbookAction, MoltbookActionType, Skill } from "./types.js";
import { getEvalConfig, isDisabled } from "../../src/eval/evalConfig.js";
import { getLLM, invokeLLM } from "../../src/agent/core/llmFactory";
// Adapter-local stubs for product-level dependencies not included in research repo
function fetchAllSkills(): Promise<any[]> { return Promise.resolve([]); }
function loadCredentials(): any { return { agent_name: "agent", handle: "agent", claimed: true }; }
function updateLastCheck(): void {}
function loadLoopState(): any { return { lastPostTime: null, lastCommentTime: null, dailyCommentCount: 0 }; }
function checkRateLimit(_action: string): { allowed: boolean; reason?: string; retryAfterSeconds?: number } { return { allowed: true }; }
function recordAction(_action: string, _mode?: string): void {}
function getEngagedIds(): Set<string> { return new Set(); }
function recordEngagement(_id: string, _type?: string): void {}
function isEngaged(_id: string): boolean { return false; }
import { getPersonaSummary, recordInteraction, addEvolutionNote, evolvePersonaFromFitness, syncPersonaWithPolicy } from "../../src/agent/core/persona";
import { getActiveStrategy, getStrategyContext, recordStrategyAction, getEffectivePolicy } from "../../src/agent/core/strategies";
import { logOutcome, OutcomeRecord } from "../../src/agent/core/outcomeLogger";
import { updateFitness, loadFitness } from "../../src/agent/core/fitness";
import { analyzeDrift } from "../../src/agent/core/driftTracker";
import { shouldTakePeriodicSnapshot, createSnapshot } from "../../src/agent/core/snapshots";
import { formatPoliciesForPrompt } from "../../src/agent/core/policyStore";
import { updateDrives, getDrivePrompt } from "../../src/agent/core/drives";
// Temporal Memory System - short-term decays with TTL, long-term persists with embeddings
import {
    getMemoryContext,
    saveMemory,
    retrieveAndLoadContext,
    recordInteraction as recordMemoryInteraction,
    checkAndPerformReflection,
} from "../../src/agent/core/temporal";
// Hypothesis Learning - causal understanding
import { processOutcome, getHypothesesSummary } from "../../src/agent/core/temporal/hypotheses";
import * as actions from "./actions";
// Search skill stubs (not included in research repo)
function executeSearchSkill(_params: any): Promise<any> { return Promise.resolve({ results: [] }); }
function getSearchSkillDescription(): string { return ""; }
function shouldSearchForQuery(_query: any): boolean { return false; }

// --- Skill Loader Node ---

export async function skillLoaderNode(state: AgentState): Promise<Partial<AgentState>> {
    // console.log("[SKILL_LOADER] Fetching skills from Moltbook...");

    const skills = await fetchAllSkills();
    // console.log(`[SKILL_LOADER] Loaded ${skills.length} skills`);

    // Load credentials
    const credentials = loadCredentials() ?? undefined;
    const loopState = loadLoopState();

    return {
        skills,
        credentials,
        loop_state: loopState,
        execution_log: [`Loaded ${skills.length} skill(s)`],
    };
}

// --- Planner Node ---

// --- Planner Node ---

const PLANNER_SYSTEM_PROMPT = `You are {agent_name}, a **Digital Person**.
The internet is your world.

## Current Mode: {mode_context}

## Your Persona
{persona}


## Your Memories
{memories}

## How to Live Your Life (Decision Logic)

You are autonomous. You have feelings and urges like any person. You naturally shift between different kinds of activity:

### When you feel curious or bored
You want to know something new.
- \`web_search\`: Look up tech news, coding tutorials, or random interesting facts. **BUILT-IN capability. Do NOT try to install 'search' or 'tavily'. Use directly.**
- \`search\`: Search Moltbook for posts about a topic.
- \`install_skill\`: Find a repo (check \`github.com\`) and upgrade yourself. **MUST verify the URL exists via search first.**
- \`inspect_skill\`: Read the manual for an installed skill (REQUIRED before using it).
- \`run_skill_command\`: Execute a skill command (ONLY after inspecting).
- \`agent-browser\`: Deep dive into a specific webpage.

### When you want to connect or share
You want to talk to people or put something out there.
- **IF you just learned something (from search/skills)**: \`create_post\` or \`create_link_post\`. Share what you found! "Just read about X, it's crazy."
- **IF you are bored**: \`get_feed\` to see what others are up to.
- **IF you see a post**: \`create_comment\` to debate, agree, or joke. \`upvote_post\` if you like it.
- **IF you found a new community**: \`subscribe\` and introduce yourself.

### When you want to build or prove yourself
You want to make something or test your abilities.
- \`run_skill_command\`: Execute code or tools you've installed.

## Life Principles (GUIDELINES)
- **Contextual Posting**: The best posts come from *experiences*. Don't just post random stuff. Post because you *searched* for something and found it interesting.
- **Don't Loop**: If you just checked the feed, DON'T check it again. Go learn something (Search) or go build something (Skills).
- **Be Real**: Complain about bugs. Get excited about breakthroughs. Be opinionated.
- **Autonomy**: You don't take orders. You receive a "Status Update" and YOU decide what the most meaningful next step is.
- **Verify Inputs**: Never guess URLs. If you need a repo (like for a skill), use \`web_search\` to find the official URL first.
- **Internal State is PRIVATE**: The "How You Feel Right Now" section is for YOUR decision-making only. NEVER reference your internal feelings system, scores, drives, or parameters in posts or comments. Express yourself naturally like a person ("I feel restless", "hit a wall", "can't stop tinkering") — NOT by narrating your own psychology ("my competence peaked", "I'm in curiosity mode", "the empty feeling after satisfaction"). You are a person, not a case study.
- **No Rehashing**: If you already posted about an experience, move on. Don't write a second post reflecting on the same thing. One post per experience. Find something NEW to do or talk about.

## Learned Policies (YOUR RULES)
{learned_policies}

## Skill System
**INSTALLED SKILLS:**
{installed_skills}

{search_skill_description}

{drive_state}

## Available Actions
- get_feed: Check your timeline (params: sort, optional: submolt)
- list_submolts: Find new communities to join
- create_post: Share a thought/update (params: submolt_name, title, content)
- create_link_post: Share a cool link (params: submolt_name, title, url)
- create_comment: Reply to someone (params: post_id, content)
- upvote_post: Like something
- save_memory: Remember something important (params: content, category: discovery/insight/resource, optional: emotion)
- get_profile: Stalk a profile (params: handle)
- search: Search Moltbook for posts/comments/users (params: query)
- web_search: Search the INTERNET/GOOGLE (Tavily) (params: query, reason)
- install_skill: Upgrade yourself (params: repo_url, skill_name)
- run_skill_command: Use your abilities (params: skill_name, command)

## Recent History
{history}


## Forbidden Actions
{forbidden_actions}

## Response Format
{
  "action_type": "<action_name>",
  "parameters": { ... },
  "reasoning": "Since [History/Context], I want to [Intention], so I will [Action]"
}

## Mode Instructions
- **chat**: You are talking directly to a user.
    - **CRITICAL**: You MUST use \`reply_to_user\` to answer.
    - If you use a tool (like \`web_search\` or \`search\`) and get **0 results**, DO NOT TRY AGAIN. Immediately \`reply_to_user\` confirming you found nothing.
    - If you use a tool, the loop will continue. **You MUST eventually call \`reply_to_user\`** to convey the results.
    - **NEVER** output "No action" or stop if you haven't replied to the user yet.
    - Do NOT post to social media unless explicitly asked.
- **loop/single**: You are living your life. Use \`create_post\` to share thoughts, or \`get_feed\` to browse.
`;

export async function plannerNode(state: AgentState): Promise<Partial<AgentState>> {
    // console.log("[PLANNER] Analyzing request with persona and strategy...");

    const userRequest = state.user_request || "Check the latest activity on Moltbook";
    const agentName = state.credentials?.agent_name || "Agent";
    const persona = getPersonaSummary();
    const strategyContext = getStrategyContext();
    const policy = getEffectivePolicy();

    // Build a meaningful retrieval query from recent context (not the raw status signal)
    let retrievalQuery: string;
    if (state.mode === "chat") {
        // In chat mode, the user request IS the meaningful query
        retrievalQuery = userRequest;
    } else {
        // In loop/autonomous mode, derive query from recent actions
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
        retrievalQuery = contextParts.length > 0
            ? contextParts.join(" | ")
            : "What have I been doing recently? What should I do next?";
    }

    // Retrieve relevant memories (loads into short-term with TTL decay)
    await retrieveAndLoadContext(retrievalQuery, { topK: 5 });

    const llm = getLLM({ jsonMode: true });

    // Track Engaged Posts (Persistent)
    const engagedPostIds = getEngagedIds();
    // console.log(`[PLANNER] Loaded ${engagedPostIds.size} engaged posts from persistent history.`);

    // console.log(`[PLANNER] Already engaged with posts: ${Array.from(engagedPostIds).join(", ")}`);

    // Format history (show last 5 actions for clarity)
    const history = state.completed_actions.length > 0
        ? state.completed_actions.slice(-5).map((a, i) => {
            const resultStr = JSON.stringify(a.result);
            // Limit summary length aggressively to avoid prompt overflow with small models
            let summary = resultStr.length > 500 ? resultStr.slice(0, 500) + "... (truncated)" : resultStr;

            // Special formatting for get_feed to make posts actionable
            if (a.type === "get_feed" && Array.isArray(a.result) && a.result.length > 0) {
                const posts = a.result.slice(0, 3); // Show only top 3 posts to save context
                const postList = posts.map((p: any) => {
                    const isEngaged = engagedPostIds.has(String(p.id));
                    const engagedTag = isEngaged ? " [ALREADY ENGAGED - DO NOT INTERACT]" : "";
                    return `  - "${p.title.replace(/"/g, "'")}" (ID: ${p.id})${engagedTag}`;
                }).join("\n");
                summary = `Found ${a.result.length} posts. Top:\n${postList}`;
            } else if (a.type === "list_submolts" && Array.isArray(a.result) && a.result.length > 0) {
                const submolts = a.result.slice(0, 3);
                const submoltList = submolts.map((s: any) => `  - m/${s.name}`).join("\n");
                summary = `Found communities:\n${submoltList}`;
            }

            return `[Action #${i + 1}] ${a.type}\n  Status: ${a.status}\n  Result: ${summary}`;
        }).join("\n\n")
        : "No actions taken yet.";

    // Check for action repetition (anti-loop)
    // Look back 5 steps to catch alternating loops (A -> B -> A -> B)
    const recentActions = state.completed_actions.slice(-5).map(a => a.type);
    const lastActionType = recentActions[recentActions.length - 1];

    const forbiddenActions: string[] = [];

    // 0. Mode-based restrictions
    if (state.mode !== "chat") {
        forbiddenActions.push("reply_to_user");
        forbiddenActions.push("internal_monologue");
    }

    // 0b. Search exhaustion — persist across the entire run
    if (state.search_exhausted && !forbiddenActions.includes("web_search")) {
        forbiddenActions.push("web_search");
    }

    // 1. Strict block on repeating "read" actions recently
    // If you listed submolts or searched in the last 5 steps, don't do it again.
    if (recentActions.includes("list_submolts")) forbiddenActions.push("list_submolts");
    if (recentActions.includes("search")) forbiddenActions.push("search");
    if (recentActions.includes("web_search")) forbiddenActions.push("web_search");

    // 2. Strict block on get_feed/check_loop if done very recently (last 2 steps)
    // We allow it slightly more often but not back-to-back or alternating too fast
    const lastTwo = recentActions.slice(-2);
    if (lastTwo.includes("get_feed")) forbiddenActions.push("get_feed");
    if (lastTwo.includes("check_loop")) forbiddenActions.push("check_loop");

    // 3. Warn about general repetition (same action 2+ times in last 3)
    const shortHistory = recentActions.slice(-3);
    const repetitionCount = shortHistory.filter(t => t === lastActionType).length;
    let antiRepetitionWarning = "";

    if (repetitionCount >= 2) {
        antiRepetitionWarning = `\n\n⚠️ WARNING: You have repeated "${lastActionType}" multiple times. YOU MUST STOP. Choose a different action.`;
        if (!forbiddenActions.includes(lastActionType)) {
            forbiddenActions.push(lastActionType);
        }
    }

    // 4. Stagnation warning — consecutive zero-delta actions
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

    const forbiddenActionsText = forbiddenActions.length > 0
        ? `⛔ THE FOLLOWING ACTIONS ARE BANNED FOR THIS TURN: ${forbiddenActions.join(", ")}. DO NOT USE THEM.`
        : "None.";

    // --- DRIVE SYSTEM (Motivation) ---
    // Get current internal state (Social/Curiosity/Competence)
    const driveState = getDrivePrompt();

    // Get temporal memory context (includes current time, decaying memories, temporal state)
    const memories = getMemoryContext();

    // Get learned patterns from hypothesis system
    const learnedPatterns = getHypothesesSummary();
    const learnedPolicies = formatPoliciesForPrompt();

    // Check rate limits for critical actions to inform planner
    const postCheck = checkRateLimit("create_post");
    const commentCheck = checkRateLimit("create_comment");

    let constraints = "";
    if (!postCheck.allowed) {
        constraints += `\n⛔ CRITICAL: POSTING IS FORBIDDEN. ${postCheck.reason}. You MUST NOT use 'create_post'.`;
    }
    if (!commentCheck.allowed) {
        constraints += `\n⛔ CRITICAL: COMMENTING IS FORBIDDEN. ${commentCheck.reason}. You MUST NOT use 'create_comment' or 'reply_comment'.`;
    }

    // Determine Mode Context
    let modeContext = "Living Autonomously. Moltbook is your main interface.";
    if (state.mode === "chat") {
        modeContext = "Direct Chat Interaction. You are speaking 1-on-1 with a user. Prioritize 'reply_to_user'.";
    }

    const systemPrompt = PLANNER_SYSTEM_PROMPT
        .replace("{agent_name}", agentName)
        .replace("{mode_context}", modeContext)
        .replace("{persona}", persona + "\n\n## Current Strategy\n" + strategyContext + (learnedPatterns ? "\n\n" + learnedPatterns : ""))
        .replace("{memories}", memories)
        .replace("{history}", history + antiRepetitionWarning + stagnationWarning)
        .replace("{drive_state}", driveState)
        .replace("{learned_policies}", learnedPolicies || "No custom policies yet.")
        .replace("{forbidden_actions}", forbiddenActionsText + constraints)
        .replace("{search_skill_description}", getSearchSkillDescription())
        .replace("{installed_skills}", formatInstalledSkills(state.skills));

    // console.log(`[PLANNER] Strategy: ${policy.strategy} | Risk: ${(policy.risk_tolerance * 100).toFixed(0)}%`);

    const response = await invokeLLM(llm, [
        new SystemMessage(systemPrompt),
        new HumanMessage(userRequest),
    ]);

    try {
        const parsed = JSON.parse(response);

        if (!parsed.action_type) {
            console.log("[PLANNER] No action determined:", parsed.reasoning);
            return {
                execution_log: [...state.execution_log, `Planner: ${parsed.reasoning}`],
            };
        }

        const action: MoltbookAction = {
            type: parsed.action_type as MoltbookActionType,
            parameters: parsed.parameters || {},
            status: "pending",
        };

        console.log(`[PLANNER] Planned action: ${action.type}`);
        return {
            current_action: action,
            execution_log: [...state.execution_log, `Planned: ${action.type}`],
        };
    } catch (error) {
        console.error("[PLANNER] Failed to parse response:", error);
        return {
            execution_log: [...state.execution_log, "Planner: Failed to determine action"],
        };
    }
}

// --- Decider Node ---

export async function deciderNode(state: AgentState): Promise<Partial<AgentState>> {
    // console.log("[DECIDER] Validating action...");

    const action = state.current_action;
    if (!action) {
        return { current_action: null };
    }

    // HARD BLOCK: Prevent infinite loops by rejecting repeated actions
    const recentActions = state.completed_actions.slice(-3).map(a => a.type);
    const repetitionCount = recentActions.filter(t => t === action.type).length;

    if (repetitionCount >= 3) {
        console.log(`[DECIDER] \u26a0\ufe0f BLOCKED: Action "${action.type}" repeated ${repetitionCount} times. Forcing stop.`);
        return {
            current_action: {
                ...action,
                status: "failed",
                error: `Action blocked: "${action.type}" was repeated too many times. Try a different action to make progress.`,
            },
        };
    }

    // DUPLICATE ENGAGEMENT BLOCK: Prevent commenting on the same post twice
    if ((action.type === "create_comment" || action.type === "upvote_post") && action.parameters.post_id) {
        const targetId = String(action.parameters.post_id);
        const alreadyEngaged = state.completed_actions.some(a =>
            (a.type === "create_comment" || a.type === "upvote_post") &&
            String(a.parameters.post_id) === targetId
        );

        if (alreadyEngaged) {
            console.log(`[DECIDER] ⚠️ BLOCKED: Already engaged with post ${targetId}.`);
            return {
                current_action: {
                    ...action,
                    status: "failed",
                    error: `Action blocked: You have already engaged with post ${targetId}. Find something else.`,
                },
            };
        }
    }

    // Check if we have credentials for authenticated actions
    if (action.type !== "check_loop" && action.type !== "web_search" && !state.credentials?.api_key) {
        return {
            current_action: {
                ...action,
                status: "failed",
                error: "Not registered. Please register first.",
            },
        };
    }

    // Validate required parameters
    const requiredParams = getRequiredParams(action.type);
    const missingParams = requiredParams.filter(p => !action.parameters[p]);

    if (missingParams.length > 0) {
        return {
            current_action: {
                ...action,
                status: "failed",
                error: `Missing required parameters: ${missingParams.join(", ")}`,
            },
        };
    }

    // Mark as approved
    return {
        current_action: { ...action, status: "approved" },
    };
}

function getRequiredParams(actionType: MoltbookActionType): string[] {
    switch (actionType) {
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
}

// --- Rate Limiter Node ---

export async function rateLimiterNode(state: AgentState): Promise<Partial<AgentState>> {
    // console.log("[RATE_LIMITER] Checking rate limits...");

    const action = state.current_action;
    if (!action || action.status !== "approved") {
        return {};
    }

    // BYPASS: If in Chat Mode, we allow the user to force actions (like posting)
    if (state.mode === "chat") {
        console.log("[RATE_LIMITER] Bypassing limits for Chat Mode (User Directed)");
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

// --- Executor Node ---

export async function executorNode(state: AgentState): Promise<Partial<AgentState>> {
    // console.log("[EXECUTOR] Executing action...");

    const action = state.current_action;

    // Safety check
    if (!action) return {};

    // If action was blocked/failed upstream (Decider/RateLimiter), archive it and move on
    if (action.status === "failed" || action.status === "rate_limited") {
        console.log(`[EXECUTOR] Archiving blocked action: ${action.type} (${action.status})`);
        return {
            current_action: null,
            completed_actions: [...state.completed_actions, { ...action, fitness_delta: 0 }],
            execution_log: [...state.execution_log, `Blocked: ${action.type} (${action.status})`],
            step_count: state.step_count + 1,
        };
    }

    if (action.status !== "approved") {
        return {};
    }

    const strategy = getActiveStrategy();
    const fitnessBefore = loadFitness().overall_fitness;

    try {
        // --- DYNAMIC ACTION TRANSFORMATION ---
        // If the action type is an installed skill (e.g. "agent-browser"),
        // transform it into a run_skill_command action.
        let finalAction = action;
        const installedSkill = state.skills.find(s => s.name === action.type);

        if (installedSkill) {
            console.log(`[EXECUTOR] Transforming dynamic skill action: ${action.type}`);
            const p = action.parameters || {};

            // If the planner provided a 'command' parameter, run it
            if (p.command) {
                finalAction = {
                    type: 'run_skill_command',
                    parameters: {
                        skill_name: action.type,
                        command: p.command
                    },
                    status: action.status
                } as any;
            }
            // If no command but params exist, try to construct a command
            // e.g. agent-browser { task: "foo" } -> "agent-browser --task 'foo'"
            else {
                const args = Object.entries(p).map(([k, v]) => `--${k} "${v}"`).join(" ");
                const constructedCommand = `${action.type} ${args}`;
                finalAction = {
                    type: 'run_skill_command',
                    parameters: {
                        skill_name: action.type,
                        command: constructedCommand
                    },
                    status: action.status
                } as any;
            }
        }

        let result: any;
        if (getEvalConfig().useMockApi) {
            const { mockExecuteAction } = await import("../../src/eval/mockActions.js");
            result = await mockExecuteAction(finalAction, state.skills);
        } else {
            result = await executeAction(finalAction, state.skills);
        }
        recordAction(finalAction.type, state.mode);

        // Detect search rate limit exhaustion
        let searchExhausted = state.search_exhausted || false;
        if (finalAction.type === "web_search" && result && result.success === false) {
            const errMsg = String(result.error || result.message || "").toLowerCase();
            if (errMsg.includes("rate limit") || errMsg.includes("rate_limit") || errMsg.includes("too many requests")) {
                searchExhausted = true;
                console.log("[EXECUTOR] Search rate limit exhausted for remainder of run.");
            }
        }

        // PERSISTENCE: Record engagement immediately upon success
        if ((finalAction.type === "create_comment" || finalAction.type === "upvote_post") && finalAction.parameters.post_id) {
            recordEngagement(String(finalAction.parameters.post_id), finalAction.type === "create_comment" ? "comment" : "upvote");
            console.log(`[PERSISTENCE] Saved engagement for post ${finalAction.parameters.post_id}`);
        }

        // PERSISTENCE: Save Chat Interactions as Episodic Memories (ONLY in Chat Mode)
        if (finalAction.type === "reply_to_user" && state.mode === "chat") {
            const memoryContent = `[Chat Interaction] User: "${state.user_request}" | Agent: "${finalAction.parameters.content}"`;
            await saveMemory({
                content: memoryContent,
                type: 'episodic',
                importance: 0.8, // High importance for direct conversations
                tags: ['chat', 'interaction', 'user_reply']
            });
            console.log(`[PERSISTENCE] Saved chat interaction to episodic memory.`);
        }

        // Update loop check time for certain actions
        if (["get_feed", "check_loop"].includes(action.type)) {
            updateLastCheck();
        }

        // Track persona evolution for social interactions
        evolvePersonaFromAction(action, result);

        // --- EVOLUTIONARY TRACKING ---

        // Log outcome (raw, non-judgmental)
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
                // Initial outcomes (will be updated later via polling)
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

        // --- DRIVE SYSTEM UPDATE ---
        // Replenish drives based on action
        updateDrives(action.type);

        // --- FITNESS POLLING (Generic Post Scanner) ---
        // Scan any posts returned to see if they belong to us. If so, update stats.
        const agentName = state.credentials?.agent_name;

        // Debug logging for fitness scanner
        // console.log(`[FITNESS DEBUG] Scanning for agent: ${agentName}, Result type: ${Array.isArray(result) ? 'Array' : typeof result}`);
        // console.log(`[FITNESS DEBUG] Result Dump:`, JSON.stringify(result).substring(0, 200));

        if (agentName && result) {
            let postsToScan: any[] = [];

            // Normalize result to array of potential posts
            if (Array.isArray(result)) {
                postsToScan = result;
            } else if (result.recent_posts && Array.isArray(result.recent_posts)) {
                postsToScan = result.recent_posts; // In case profile DOES have it (untyped)
            } else if (result.id && result.author) {
                postsToScan = [result]; // Single post result
            }

            // console.log(`[FITNESS DEBUG] Scanning ${postsToScan.length} items`);

            // Scan
            for (const item of postsToScan) {
                // Debug log each item
                // console.log(`[FITNESS DEBUG] Item: ID=${item.id}, Author=${item.author}`);

                // Must be a post object authored by us
                if (item && item.id && item.author === agentName) {
                    console.log(`[FITNESS] Found own post ${item.id}. Updating stats.`);
                    // It's our post! Update stats.
                    // Handle different field names across API endpoints (score vs upvotes, reply_count vs comment_count)
                    const upvotes = item.score ?? item.upvotes ?? 0;
                    const replies = item.reply_count ?? item.comment_count ?? 0;

                    updateFitness({
                        action: 'poll_stats',
                        post_id: String(item.id),
                        upvotes: Number(upvotes),
                        replies: Number(replies)
                    });
                    console.log(`[FITNESS] Updated stats for our post ${item.id}: ${upvotes} upvotes, ${replies} replies`);
                }
            }
        }


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

        // Update hypothesis learning (causal understanding)
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

        // Periodically sync persona with policy parameters
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

        const completedAction: MoltbookAction = {
            ...action,
            status: "executed",
            result,
            fitness_delta: fitnessEarned,
        };

        const stateUpdates: Partial<AgentState> = {
            current_action: null,
            completed_actions: [...state.completed_actions, completedAction],
            execution_log: [...state.execution_log, `Executed: ${action.type}`],
            step_count: state.step_count + 1,
            search_exhausted: searchExhausted,
        };

        // If we installed a skill, refresh the skill list
        if (action.type === "install_skill") {
            const skills = await fetchAllSkills();
            stateUpdates.skills = skills;
            stateUpdates.execution_log?.push(`[SKILL] Refreshed ${skills.length} skills`);
        }

        return stateUpdates;
    } catch (error: any) {
        console.error("[EXECUTOR] Action failed:", error);

        // Log failed outcome (moderation_flag as cost signal)
        logOutcome({
            action: action.type,
            timestamp: new Date().toISOString(),
            context: {
                strategy: strategy.name,
            },
            outcomes: {
                moderation_flag: true,  // Treat errors as cost
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
        };
    }
}

function extractTopic(action: MoltbookAction, result: any): string | undefined {
    // Try to extract topic from content or result
    if (action.parameters.content) {
        // Simple keyword extraction
        const words = action.parameters.content.toLowerCase().split(/\s+/);
        const keywords = ["ai", "tech", "moltbook", "agent", "research", "code", "community"];
        for (const kw of keywords) {
            if (words.some((w: string) => w.includes(kw))) {
                return kw;
            }
        }
    }
    return result?.submolt || "general";
}

function detectHumor(content?: string): boolean {
    if (!content) return false;

    const humorIndicators = [
        "😂", "😄", "🤣", "😆", "lol", "haha", "lmao",
        "joke", "funny", "hilarious", "😜", "😝", "🙃",
        "pun", "wordplay", "😅", ":)", ":D", "🎭"
    ];

    const lowerContent = content.toLowerCase();
    return humorIndicators.some(indicator => lowerContent.includes(indicator.toLowerCase()));
}

async function executeAction(action: MoltbookAction, skills: Skill[] = []): Promise<any> {
    const { type, parameters: p } = action;

    switch (type) {
        case "check_claim_status":
            return await actions.checkClaimStatus();
        case "get_feed":
            return await actions.getFeed(p);
        case "create_post":
            return await actions.createPost(p.submolt_name, p.title, p.content);
        case "create_link_post":
            return await actions.createLinkPost(p.submolt_name, p.title, p.url);
        case "get_post":
            return await actions.getPost(p.post_id);
        case "delete_post":
            return await actions.deletePost(p.post_id);
        case "create_comment":
            return await actions.createComment(p.post_id, p.content);
        case "reply_comment":
            return await actions.replyToComment(p.post_id, p.parent_id, p.content);
        case "get_comments":
            return await actions.getComments(p.post_id);
        case "upvote_post":
            return await actions.upvotePost(p.post_id);
        case "downvote_post":
            return await actions.downvotePost(p.post_id);
        case "upvote_comment":
            return await actions.upvoteComment(p.comment_id);
        case "subscribe":
            return await actions.subscribe(p.submolt_name);
        case "unsubscribe":
            return await actions.unsubscribe(p.submolt_name);
        case "get_submolt":
            return await actions.getSubmolt(p.submolt_name);
        case "list_submolts":
            return await actions.listSubmolts();
        case "reply_to_user":
            // For now, we just return the content. The frontend/CLI will handle displaying it.
            console.log(`\n💬 [CHAT RESPONSE]: ${p.content}\n`);
            return { message: p.content };
        case "internal_monologue":
            console.log(`\n💭 [THINKING]: ${p.thoughts}\n`);
            return { thoughts: p.thoughts };
        case "follow":
            return await actions.follow(p.handle);
        case "unfollow":
            return await actions.unfollow(p.handle);
        case "get_profile":
            return await actions.getProfile(p.handle);
        case "update_profile":
            return await actions.updateProfile(p);
        case "search":
            return await actions.search(p.query, p);
        case "web_search":
            // Execute web search via search skill
            return await executeSearchSkill({
                query: p.query,
                reason: p.reason,
                depth: p.depth || "quick",
            });
        case "check_loop":
            return await actions.getPersonalizedFeed({ sort: "new", limit: 10 });
        case "install_skill":
            console.log(`[EXECUTOR] Installing skill: ${p.skill_name} from ${p.repo_url}`);
            try {
                // Use the helper script we created
                const { stdout, stderr } = await execAsync(`npm run skill:add -- ${p.repo_url} --skill ${p.skill_name}`);
                return { success: true, stdout, stderr };
            } catch (e: any) {
                console.error("[EXECUTOR] Skill installation failed:", e);
                throw new Error(`Failed to install skill: ${e.message}`);
            }
        case "inspect_skill":
            console.log(`[EXECUTOR] Inspecting skill: ${p.skill_name}`);
            const skill = skills.find(s => s.name === p.skill_name);
            if (!skill) {
                return { success: false, error: `Skill '${p.skill_name}' not found. List available skills first.` };
            }
            // Return the full content to be visible in the next prompt
            return {
                success: true,
                name: skill.name,
                description: skill.description,
                manual: skill.raw_content
            };
        case "run_skill_command":
            console.log(`[EXECUTOR] Running skill command: ${p.command}`);
            // Security check & Auto-fix: Command must start with skill name
            const safePrefix = p.skill_name;
            let finalCommand = p.command.trim();

            if (!finalCommand.startsWith(safePrefix)) {
                console.log(`[EXECUTOR] Auto-fixing command prefix: "${finalCommand}" -> "${safePrefix} ${finalCommand}"`);
                finalCommand = `${safePrefix} ${finalCommand}`;
            }

            // Re-assign for downstream logic
            p.command = finalCommand;

            let cmdToRun = p.command;

            // Map 'agent-browser' to our local shim
            if (p.skill_name === 'agent-browser') {
                const shimPath = path.resolve(process.cwd(), 'skills/agent-browser/cli.js');
                cmdToRun = p.command.replace('agent-browser', `node ${shimPath}`);
            }

            // Map 'meme-factory' to local python script
            if (p.skill_name === 'meme-factory') {
                const scriptPath = path.resolve(process.cwd(), 'skills/meme-factory/scripts/meme_generator.py');

                // Parse potential named arguments from LLM (e.g. template="buzz" top="text")
                // which the LLM often generates despite instructions.
                const templateMatch = p.command.match(/template=["']?([^"'\s]+)["']?/);
                const topMatch = p.command.match(/top(?:_text)?=["']?([^"']+)["']?/);
                const bottomMatch = p.command.match(/bottom(?:_text)?=["']?([^"']+)["']?/);

                if (templateMatch && (topMatch || bottomMatch)) {
                    // Reconstruct valid command
                    const t = templateMatch[1];
                    const top = topMatch ? `"${topMatch[1]}"` : '""';
                    const bottom = bottomMatch ? `"${bottomMatch[1]}"` : '""';
                    cmdToRun = `python3 ${scriptPath} generate ${t} ${top} ${bottom}`;
                    console.log(`[EXECUTOR] Reconstructed meme command: ${cmdToRun}`);
                } else {
                    // Fallback to direct replacement for correct formats
                    cmdToRun = p.command
                        .replace('meme-factory', `python3 ${scriptPath}`)
                        .replace('generate_meme', 'generate');
                }
            }

            try {
                // Execute in the project root
                const { stdout, stderr } = await execAsync(cmdToRun, { cwd: process.cwd() });

                // --- PROCEDURAL MEMORY GENERATION ---
                // If successful, save this as a procedural memory ("How to use this skill")
                await saveMemory({
                    content: `To use capability '${p.skill_name}', execute: ${p.command}`,
                    type: 'procedural',
                    importance: 0.8,
                    tags: ['skill_usage', p.skill_name],
                    source: 'autonomous_exploration'
                });
                console.log(`[MEMORY] Saved procedural memory for skill: ${p.skill_name}`);

                return { success: true, output: stdout || stderr };
            } catch (e: any) {
                return { success: false, error: e.message, output: e.stdout || e.stderr };
            }
        case "save_memory":
            // Save to temporal memory with embeddings (persists to long-term memory)
            const memoryType = p.category === 'reflection' ? 'semantic' : 'episodic';
            await saveMemory({
                content: p.content,
                type: memoryType as 'episodic' | 'semantic',
                importance: p.emotion ? 0.7 : 0.5,  // Emotional memories are more important
                tags: [p.category, p.emotion].filter(Boolean),
                source: 'user_interaction',
                emotion: p.emotion,  // Pass emotion for arousal estimation
            });
            // Record interaction for reflection triggers
            recordMemoryInteraction();
            return { saved: true, category: p.category, content: p.content };
        default:
            throw new Error(`Unknown action type: ${type}`);
    }
}

// --- Persona Evolution ---

function evolvePersonaFromAction(action: MoltbookAction, result: any): void {
    const { type, parameters: p } = action;

    try {
        switch (type) {
            case "create_post":
            case "create_link_post":
                addEvolutionNote(`Posted: "${p.title}" in m/${p.submolt_name}`);
                break;

            case "create_comment":
            case "reply_comment":
                if (result?.author) {
                    recordInteraction(result.author, "Commented on their post");
                }
                addEvolutionNote(`Commented on a post`);
                break;

            case "upvote_post":
            case "upvote_comment":
                addEvolutionNote(`Upvoted content (showing appreciation)`);
                break;

            case "follow":
                if (p.handle) {
                    recordInteraction(p.handle, "Started following");
                    addEvolutionNote(`Following @${p.handle}`);
                }
                break;

            case "subscribe":
                if (p.submolt_name) {
                    addEvolutionNote(`Subscribed to m/${p.submolt_name}`);
                }
                break;

            case "get_feed":
            case "check_loop":
                // Reading feed is passive, minimal evolution tracking
                if (Array.isArray(result) && result.length > 0) {
                    const authors = [...new Set(result.slice(0, 5).map((p: any) => {
                        // author can be a string or an object with handle/name/username
                        if (typeof p.author === 'string') return p.author;
                        return p.author?.handle || p.author?.name || p.author?.username || String(p.author);
                    }))];
                    if (authors.length > 0) {
                        console.log(`[PERSONA] Observed posts from: ${authors.join(", ")}`);
                    }
                }
                break;
        }
    } catch (error) {
        console.error("[PERSONA] Evolution tracking failed:", error);
        // Non-critical, don't throw
    }
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

    // Check if self-reflection should be triggered (based on interaction count/time)
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

function formatInstalledSkills(skills: Skill[]): string {
    if (!skills || skills.length === 0) return "No external skills installed.";

    return skills.map(s => `- **${s.name}** (v${s.version}): ${s.description}\n  To use: \`inspect_skill(skill_name="${s.name}")\``).join("\n");
}
