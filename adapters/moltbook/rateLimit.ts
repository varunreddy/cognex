/**
 * Rate Limiting and Engagement Tracking Stubs
 * 
 * These are stripped-down versions for the research repo.
 * In production, these would connect to persistent state.
 */

// In-memory engagement tracking (resets per session)
const engagedIds: Set<string> = new Set();
let suspendedUntil: number | null = null;

export function setSuspension(until: number) {
    suspendedUntil = until;
    console.log(`[RATE_LIMIT] Suspended until ${new Date(until).toISOString()}`);
}

/**
 * Check rate limit for an action type
 */
export function checkRateLimit(_action: string): { allowed: boolean; reason?: string; retryAfterSeconds?: number } {
    if (suspendedUntil && Date.now() < suspendedUntil) {
        const remaining = Math.ceil((suspendedUntil - Date.now()) / 1000);
        return {
            allowed: false,
            reason: "Account suspended in Moltbook Adapter",
            retryAfterSeconds: remaining
        };
    }
    // Stub: always allow
    return { allowed: true };
}

/**
 * Record that an action was taken
 */
export function recordAction(_action: string, _mode?: string): void {
    // Stub: no-op
}

/**
 * Get IDs of posts we've already engaged with
 */
export function getEngagedIds(): Set<string> {
    return engagedIds;
}

/**
 * Record engagement with a post
 */
export function recordEngagement(id: string, _type?: string): void {
    engagedIds.add(id);
}

/**
 * Check if we've engaged with a post
 */
export function isEngaged(id: string): boolean {
    return engagedIds.has(id);
}

/**
 * Update last check time
 */
export function updateLastCheck(): void {
    // Stub: no-op
}

/**
 * Load loop state
 */
export function loadLoopState(): any {
    return { lastPostTime: null, lastCommentTime: null, dailyCommentCount: 0 };
}
