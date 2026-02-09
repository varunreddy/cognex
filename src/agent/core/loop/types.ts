/**
 * Core Agent Loop Types
 * 
 * Adapter-agnostic interfaces for the agent loop.
 * Adapters (moltbook, search, telegram) implement AgentAdapter
 * to plug into the generic planner/decider/executor.
 */

import { BaseMessage } from "@langchain/core/messages";

// --- Base Action ---

export interface BaseAction {
    type: string;
    parameters: Record<string, any>;
    status: "pending" | "approved" | "rate_limited" | "executed" | "failed";
    result?: any;
    error?: string;
    retryAfter?: number;
    fitness_delta?: number;
}

export interface TaskScopeDecision {
    name: string;
    objective: string;
    allowed_actions: string[];
    exit?: boolean;
}

// --- Base Agent State ---

export interface BaseAgentState {
    messages: BaseMessage[];
    user_request?: string;
    mode: "single" | "loop" | "chat";
    cycle_time: number;
    current_action?: BaseAction | null;
    completed_actions: BaseAction[];
    execution_log: string[];
    step_count: number;
    max_steps: number;
    search_exhausted?: boolean;
    current_scope?: TaskScopeDecision;
    allowed_actions?: string[];
    // Adapter-specific state passed through
    adapterState?: Record<string, any>;
}

// --- Adapter Interface ---

/**
 * AgentAdapter defines the contract for pluggable adapters.
 * Each adapter provides domain-specific actions, prompts, and execution.
 */
export interface AgentAdapter<TState extends BaseAgentState = BaseAgentState> {
    /** Unique adapter name */
    name: string;

    /**
     * Build the system prompt for the planner LLM.
     * Adapter injects its persona, available actions, etc.
     */
    getSystemPrompt(state: TState, context: AdapterContext): string;

    /** List of action types this adapter supports */
    getActionTypes(): string[];

    /**
     * Get required parameters for an action type.
     * Used by decider to validate actions.
     */
    getRequiredParams(actionType: string): string[];

    /**
     * Execute an action. Called by the executor.
     * Returns the action result or throws on error.
     */
    executeAction(action: BaseAction, state: TState): Promise<any>;

    /**
     * Optional: Custom validation logic beyond required params.
     * Return error message string if invalid, null if valid.
     */
    validateAction?(action: BaseAction, state: TState): string | null;

    /**
     * Optional: Post-execution hook for adapter-specific tracking.
     */
    onActionComplete?(action: BaseAction, result: any, state: TState): void | Promise<void>;

    /**
     * Optional: Initialize adapter state.
     */
    initializeState?(): Promise<Partial<TState>>;
}

// --- Adapter Context ---

/**
 * Context passed to adapter methods.
 * Contains shared services (memory, persona, etc.)
 */
export interface AdapterContext {
    /** Current time formatted for prompt */
    currentTime: string;
    /** Persona summary */
    persona: string;
    /** Strategy context */
    strategyContext: string;
    /** Memory context */
    memories: string;
    /** Learned policies */
    learnedPolicies: string;
    /** Drive state */
    driveState: string;
    /** Learned patterns from hypothesis system */
    learnedPatterns: string;
    /** Forbidden actions for this turn */
    forbiddenActions: string[];
    /** Search skill description (if available) */
    searchSkillDescription: string;
    /** Current cycle-level scope decision */
    currentScope?: TaskScopeDecision;
    /** Scope-limited allowed actions */
    allowedActions?: string[];
}

// --- Node Factory Types ---

export type PlannerNode<TState extends BaseAgentState = BaseAgentState> =
    (state: TState) => Promise<Partial<TState>>;

export type DeciderNode<TState extends BaseAgentState = BaseAgentState> =
    (state: TState) => Promise<Partial<TState>>;

export type ExecutorNode<TState extends BaseAgentState = BaseAgentState> =
    (state: TState) => Promise<Partial<TState>>;

export type ScopeSelectorNode<TState extends BaseAgentState = BaseAgentState> =
    (state: TState) => Promise<Partial<TState>>;
