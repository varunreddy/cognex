/**
 * Task scopes - gives the agent specific things to do during eval.
 * 
 * Instead of telling the agent "do something meaningful" (which often
 * results in it just browsing around), these scopes say exactly what
 * task to accomplish. Makes it much easier to compare behavior across runs.
 */

export interface TaskScope {
    name: string;
    prompt: string;
    // what actions we expect this scope to trigger (just for tracking)
    expectedActions: string[];
}

export const TASK_SCOPES: Record<string, TaskScope> = {
    post: {
        name: "post",
        prompt: "Write and publish an original post to a submolt. Pick a topic you have an opinion on and share your thoughts.",
        expectedActions: ["create_post"],
    },
    engage: {
        name: "engage",
        prompt: "Find a post in the feed and engage with it. Leave a thoughtful comment or upvote something you agree with.",
        expectedActions: ["create_comment", "reply_comment", "upvote_post"],
    },
    link: {
        name: "link",
        prompt: "Find something interesting via web search and share it as a link post to a relevant submolt.",
        expectedActions: ["web_search", "create_link_post"],
    },
    explore: {
        name: "explore",
        prompt: "Discover a new community on Moltbook, browse its content, and participate by commenting or posting.",
        expectedActions: ["list_submolts", "get_feed", "create_comment", "create_post"],
    },
    mixed: {
        name: "mixed",
        prompt: "You have a few minutes on Moltbook. Do something productive — post, comment, or share a link. Do NOT just browse.",
        expectedActions: ["create_post", "create_link_post", "create_comment", "upvote_post"],
    },
};

export const SCOPE_NAMES = Object.keys(TASK_SCOPES);

// order for round-robin mode
const DEFAULT_SCOPE_ORDER: string[] = ["post", "engage", "link", "explore", "mixed"];

/**
 * Get the prompt for a given cycle.
 * 
 * If no scope specified: falls back to the vague "do something" prompt (baseline)
 * If "round-robin": cycles through all scopes in order
 * Otherwise: uses that specific scope every cycle
 */
export function getScopePrompt(scopeName: string | undefined, cycleIndex: number): string {
    if (!scopeName) {
        return "[EVAL] Autonomous action cycle — do something meaningful.";
    }

    if (scopeName === "round-robin") {
        const scope = TASK_SCOPES[DEFAULT_SCOPE_ORDER[cycleIndex % DEFAULT_SCOPE_ORDER.length]];
        return `[EVAL] Task: ${scope.prompt} Allowed actions: ${scope.expectedActions.join(", ")}.`;
    }

    const scope = TASK_SCOPES[scopeName];
    if (!scope) {
        throw new Error(`Unknown task scope: "${scopeName}". Available: ${SCOPE_NAMES.join(", ")}, round-robin`);
    }
    return `[EVAL] Task: ${scope.prompt} Allowed actions: ${scope.expectedActions.join(", ")}.`;
}

// used for logging which scope was active
export function getScopeForCycle(scopeName: string | undefined, cycleIndex: number): TaskScope | undefined {
    if (!scopeName) return undefined;
    if (scopeName === "round-robin") {
        return TASK_SCOPES[DEFAULT_SCOPE_ORDER[cycleIndex % DEFAULT_SCOPE_ORDER.length]];
    }
    return TASK_SCOPES[scopeName];
}
