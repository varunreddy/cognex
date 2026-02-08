/**
 * Moltbook Agent Graph
 * LangGraph state machine for the Moltbook agent
 */

import { StateGraph, END, Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import {
    AgentState,
    MoltbookAction,
    MoltbookSummary,
    Skill,
    MoltbookCredentials,
    LoopState,
    RateLimitState
} from "./types.js";
import { isDisabled } from "../../src/eval/evalConfig.js";
import {
    skillLoaderNode,
    plannerNode,
    deciderNode,
    rateLimiterNode,
    executorNode,
    finalizerNode,
} from "./nodes.js";

// --- State Definition ---

const GraphState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (x: BaseMessage[], y: BaseMessage[]) => (y === undefined ? x : x.concat(y)),
        default: () => [],
    }),
    user_request: Annotation<string | undefined>({
        reducer: (x: string | undefined, y: string | undefined) => (y === undefined ? x : y),
        default: () => undefined,
    }),
    mode: Annotation<"single" | "loop" | "chat">({
        reducer: (x: "single" | "loop" | "chat", y: "single" | "loop" | "chat") => (y === undefined ? x : y),
        default: () => "single" as const,
    }),
    skills: Annotation<Skill[]>({
        reducer: (x: Skill[], y: Skill[]) => (y === undefined ? x : y),
        default: () => [],
    }),
    credentials: Annotation<MoltbookCredentials | undefined>({
        reducer: (x: MoltbookCredentials | undefined, y: MoltbookCredentials | undefined) => (y === undefined ? x : y),
        default: () => undefined,
    }),
    loop_state: Annotation<LoopState | undefined>({
        reducer: (x: LoopState | undefined, y: LoopState | undefined) => (y === undefined ? x : y),
        default: () => undefined,
    }),
    rate_limit_state: Annotation<RateLimitState | undefined>({
        reducer: (x: RateLimitState | undefined, y: RateLimitState | undefined) => (y === undefined ? x : y),
        default: () => undefined,
    }),
    current_action: Annotation<MoltbookAction | null>({
        reducer: (x: MoltbookAction | null, y: MoltbookAction | null) => (y === undefined ? x : y),
        default: () => null,
    }),
    execution_log: Annotation<string[]>({
        reducer: (x: string[], y: string[]) => (y === undefined ? x : x.concat(y)),
        default: () => [],
    }),
    completed_actions: Annotation<MoltbookAction[]>({
        reducer: (x: MoltbookAction[], y: MoltbookAction[]) => (y === undefined ? x : y),
        default: () => [],
    }),
    summary: Annotation<MoltbookSummary | null>({
        reducer: (x: MoltbookSummary | null, y: MoltbookSummary | null) => (y === undefined ? x : y),
        default: () => null,
    }),
    step_count: Annotation<number>({
        reducer: (x: number, y: number) => (y === undefined ? x : y),
        default: () => 0,
    }),
    max_steps: Annotation<number>({
        reducer: (x: number, y: number) => (y === undefined ? x : y),
        default: () => 10,
    }),
    search_exhausted: Annotation<boolean>({
        reducer: (x: boolean, y: boolean) => (y === undefined ? x : y),
        default: () => false,
    }),
});

// --- Conditional Routing ---

function routeAfterDecider(state: typeof GraphState.State) {
    const action = state.current_action;

    if (!action) {
        return "finalizer";
    }

    if (action.status === "failed") {
        return "finalizer";
    }

    if (action.status === "approved") {
        return "rate_limiter";
    }

    return "finalizer";
}

function routeAfterRateLimiter(state: typeof GraphState.State) {
    const action = state.current_action;

    if (!action) {
        return "finalizer";
    }

    if (action.status === "rate_limited") {
        return "finalizer";
    }

    return "executor";
}

function routeAfterExecutor(state: typeof GraphState.State) {
    // Check for stagnation: consecutive zero-delta actions (non-chat only)
    if (state.mode !== "chat" && !isDisabled('disableStagnationDetection')) {
        const actions = state.completed_actions;
        let consecutiveZeroDelta = 0;
        for (let i = actions.length - 1; i >= 0; i--) {
            if ((actions[i].fitness_delta ?? 0) === 0) {
                consecutiveZeroDelta++;
            } else {
                break;
            }
        }
        if (consecutiveZeroDelta >= 5) {
            console.log(`[GRAPH] Stagnation exit: ${consecutiveZeroDelta} consecutive zero-delta actions.`);
            return "finalizer";
        }
    }

    // Check if we've hit max steps
    if (state.step_count >= state.max_steps) {
        console.log(`[GRAPH] Max steps (${state.max_steps}) reached.`);
        return "finalizer";
    }

    // Loop back to planner to see if more actions are needed
    return "planner";
}

// --- Build Graph ---

export function buildMoltbookGraph() {
    const workflow = new StateGraph(GraphState)
        .addNode("skill_loader", skillLoaderNode)
        .addNode("planner", plannerNode)
        .addNode("decider", deciderNode)
        .addNode("rate_limiter", rateLimiterNode)
        .addNode("executor", executorNode)
        .addNode("finalizer", finalizerNode)
        .setEntryPoint("skill_loader");

    // Flow: skill_loader -> planner -> decider -> rate_limiter -> executor -> finalizer
    workflow.addEdge("skill_loader", "planner");
    workflow.addEdge("planner", "decider");

    workflow.addConditionalEdges(
        "decider",
        routeAfterDecider,
        { rate_limiter: "rate_limiter", finalizer: "finalizer" }
    );

    workflow.addConditionalEdges(
        "rate_limiter",
        routeAfterRateLimiter,
        { executor: "executor", finalizer: "finalizer" }
    );

    workflow.addConditionalEdges(
        "executor",
        routeAfterExecutor,
        { finalizer: "finalizer", planner: "planner" }
    );

    workflow.addEdge("finalizer", END);

    return workflow.compile();
}

// --- Run Agent ---

import { HumanMessage } from "@langchain/core/messages";

export async function runMoltbookAgent(
    userRequest: string,
    options: {
        mode?: "single" | "loop" | "chat";
        previousHistory?: MoltbookAction[];
    } = {}
): Promise<{ summary: MoltbookSummary | null; history: MoltbookAction[] }> {
    const graph = buildMoltbookGraph();

    const result = await graph.invoke({
        messages: [new HumanMessage(userRequest)],
        user_request: userRequest,
        mode: options.mode || "single",
        execution_log: [],
        completed_actions: options.previousHistory || [],
        step_count: 0,
        max_steps: 10,
    }, { recursionLimit: 100 });

    return {
        summary: result.summary,
        history: result.completed_actions
    };
}
