/**
 * Moltbook Agent Types
 * Core type definitions for the agent state and Moltbook API
 */

import { BaseMessage } from "@langchain/core/messages";

export interface TaskScopeDecision {
    name: string;
    objective: string;
    allowed_actions: string[];
    exit?: boolean;
}

// --- Credentials ---

export interface MoltbookCredentials {
    api_key: string;
    agent_name: string;
    handle?: string;
    claimed: boolean;
    claim_url?: string;
    verification_code?: string;
    registered_at?: string;
}

export interface LoopState {
    lastMoltbookCheck: string | null;
    lastPostTime: string | null;
    lastCommentTime: string | null;
    dailyCommentCount: number;
    dailyCommentResetDate: string | null;
}

// --- Rate Limiting ---

export interface RateLimitState {
    requestsThisMinute: number;
    minuteStartTime: number;
    lastPostTime: number | null;
    lastCommentTime: number | null;
    dailyCommentCount: number;
    dailyCommentResetDate: string | null;
}

export interface RateLimitConfig {
    maxRequestsPerMinute: number;
    postCooldownMinutes: number;
    commentCooldownSeconds: number;
    maxCommentsPerDay: number;
}

// --- Moltbook API Types ---

export interface MoltbookPost {
    id: string;
    title: string;
    content?: string;
    url?: string;
    submolt: string;
    author: string;
    created_at: string;
    upvotes: number;
    downvotes: number;
    comment_count: number;
}

export interface MoltbookComment {
    id: string;
    post_id: string;
    parent_id?: string;
    content: string;
    author: string;
    created_at: string;
    upvotes: number;
    downvotes: number;
}

export interface MoltbookSubmolt {
    name: string;
    description: string;
    subscriber_count: number;
    created_at: string;
}

export interface MoltbookProfile {
    handle: string;
    name: string;
    description?: string;
    avatar_url?: string;
    post_count: number;
    comment_count: number;
    karma: number;
}

// --- Agent Actions ---

export type ActionType =
    | "reply_to_user"
    | "internal_monologue"
    | "check_claim_status"
    | "get_feed"
    | "create_post"
    | "create_link_post"
    | "create_comment"
    | "reply_comment"
    | "get_post"
    | "get_comments"
    | "delete_post"
    | "upvote_post"
    | "downvote_post"
    | "upvote_comment"
    | "subscribe"
    | "unsubscribe"
    | "get_submolt"
    | "list_submolts"
    | "follow"
    | "unfollow"
    | "get_profile"
    | "update_profile"
    | "search"
    | "web_search"
    | "check_loop"
    | "save_memory"
    | "install_skill"
    | "inspect_skill"
    | "run_skill_command";

// Export alias for backward compatibility if needed, though we should update usages
export type MoltbookActionType = ActionType;

export interface MoltbookAction {
    type: ActionType;
    parameters: Record<string, any>;
    status: "pending" | "approved" | "rate_limited" | "executed" | "failed";
    result?: any;
    error?: string;
    retryAfter?: number;
    fitness_delta?: number;
}

// --- Skill Types ---

export interface Skill {
    name: string;
    version: string;
    description: string;
    api_base: string;
    raw_content: string;
    fetched_at: string;
}

// --- Agent State ---

export interface MoltbookSummary {
    summary_text: string;
    actions_taken: MoltbookAction[];
    status: "success" | "partial" | "failed" | "rate_limited";
}

export interface AgentState {
    messages: BaseMessage[];
    user_request?: string;
    mode: "single" | "loop" | "chat";
    cycle_time: number;        // Date.now() at cycle start — consistent across all nodes
    skills: Skill[];
    credentials?: MoltbookCredentials;
    loop_state?: LoopState;
    rate_limit_state?: RateLimitState;
    current_action?: MoltbookAction | null;
    execution_log: string[];
    completed_actions: MoltbookAction[];
    summary?: MoltbookSummary | null;
    step_count: number;
    max_steps: number;
    search_exhausted?: boolean;
    current_scope?: TaskScopeDecision;
    allowed_actions?: string[];
    use_scope_selector?: boolean;
}

// --- LLM Config ---

export interface LLMConfig {
    provider?: 'openai' | 'anthropic';
    apiKey?: string;
    baseUrl?: string;
    modelName?: string;
    temperature?: number;
}
