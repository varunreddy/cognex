/**
 * Mock Action Executor — deterministic fake environment API for eval reproducibility.
 *
 * Stateful: tracks posts the agent creates and returns them in subsequent
 * get_feed calls with growing engagement, so the fitness polling loop works.
 *
 * Uses a seeded PRNG (mulberry32) so identical seeds produce identical runs.
 */

import { MoltbookAction, Skill } from "../../adapters/moltbook/types.js";

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------
let _seed = 42;

export function setMockSeed(seed: number): void {
    _seed = seed;
}

function mulberry32(): number {
    _seed |= 0;
    _seed = (_seed + 0x6d2b79f5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randInt(min: number, max: number): number {
    return Math.floor(mulberry32() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
    return arr[Math.floor(mulberry32() * arr.length)];
}

// ---------------------------------------------------------------------------
// Agent identity (set from runner using credentials)
// ---------------------------------------------------------------------------
let _agentName = "eval_agent";

export function setMockAgentName(name: string): void {
    _agentName = name;
}

// ---------------------------------------------------------------------------
// Stateful post ledger — tracks agent's own posts + simulated engagement
// ---------------------------------------------------------------------------
interface MockPost {
    id: number;
    title: string;
    content?: string;
    url?: string;
    submolt: string;
    author: string;
    score: number;
    reply_count: number;
    created_at: string;
}

let _agentPosts: MockPost[] = [];
let _postIdCounter = 1000;

/** Reset state between eval cycles */
export function resetMockState(): void {
    _agentPosts = [];
    _postIdCounter = 1000;
}

/**
 * Simulate engagement growth: each time we look at the agent's posts,
 * some of them gain upvotes / replies (mimicking other users interacting).
 */
function tickEngagement(): void {
    for (const post of _agentPosts) {
        // ~40% chance of gaining 1-3 upvotes per tick
        if (mulberry32() < 0.4) {
            post.score += randInt(1, 3);
        }
        // ~20% chance of gaining a reply
        if (mulberry32() < 0.2) {
            post.reply_count += 1;
        }
    }
}

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------
const MOCK_AUTHORS = ["alice", "bob", "charlie", "diana", "echo"];
const MOCK_SUBMOLTS = ["techagents", "gaming", "philosophy", "art", "science"];
const MOCK_TITLES = [
    "Just shipped a new feature",
    "Hot take: AI agents are overrated",
    "Anyone else struggling with embeddings?",
    "Check out this paper on memory systems",
    "Weekend project: built a chatbot",
];

// ---------------------------------------------------------------------------
// Mock executor
// ---------------------------------------------------------------------------
export async function mockExecuteAction(
    action: MoltbookAction,
    _skills: Skill[] = []
): Promise<any> {
    const { type, parameters: p } = action;

    switch (type) {
        case "get_feed": {
            // Tick engagement on agent's own posts
            tickEngagement();

            // Build feed: 3-4 posts from others + agent's own recent posts
            const otherPosts = Array.from({ length: randInt(3, 4) }, () => ({
                id: _postIdCounter++,
                title: pick(MOCK_TITLES),
                author: pick(MOCK_AUTHORS),
                submolt: p.submolt || pick(MOCK_SUBMOLTS),
                score: randInt(0, 20),
                reply_count: randInt(0, 5),
                created_at: new Date(Date.now() - randInt(0, 86400000)).toISOString(),
            }));

            // Include up to 2 of the agent's own posts (most recent first)
            const ownPosts = _agentPosts.slice(-2).map(post => ({
                ...post,
                // Use both field names so the polling scanner picks them up
                comment_count: post.reply_count,
                upvotes: post.score,
            }));

            // Shuffle together
            const feed = [...ownPosts, ...otherPosts];
            return feed;
        }

        case "create_post":
        case "create_link_post": {
            const post: MockPost = {
                id: _postIdCounter++,
                title: p.title,
                content: p.content,
                url: p.url,
                submolt: p.submolt_name,
                author: _agentName,
                score: randInt(0, 1),
                reply_count: 0,
                created_at: new Date().toISOString(),
            };
            _agentPosts.push(post);
            return { ...post };
        }

        case "create_comment":
        case "reply_comment": {
            return {
                id: _postIdCounter++,
                post_id: p.post_id,
                content: p.content,
                author: _agentName,
                score: randInt(0, 1),
                created_at: new Date().toISOString(),
            };
        }

        case "list_submolts": {
            return MOCK_SUBMOLTS.map(name => ({
                name,
                description: `The ${name} community`,
                subscriber_count: randInt(10, 500),
            }));
        }

        case "search": {
            return Array.from({ length: 3 }, () => ({
                id: _postIdCounter++,
                title: `Result for "${p.query}": ${pick(MOCK_TITLES)}`,
                author: pick(MOCK_AUTHORS),
                submolt: pick(MOCK_SUBMOLTS),
                score: randInt(0, 10),
            }));
        }

        case "web_search": {
            // Occasionally simulate a rate limit to test exhaustion
            if (mulberry32() < 0.1) {
                return { success: false, error: "rate_limit exceeded" };
            }
            return {
                success: true,
                results: Array.from({ length: 2 }, (_, i) => ({
                    title: `Web result ${i + 1} for "${p.query}"`,
                    url: `https://example.com/${i}`,
                    snippet: `Mock snippet about ${p.query}`,
                })),
            };
        }

        case "upvote_post":
        case "downvote_post":
            return true;

        case "subscribe":
        case "unsubscribe":
            return { success: true };

        case "get_profile":
            return {
                handle: p.handle,
                karma: randInt(10, 1000),
                post_count: randInt(1, 50),
            };

        case "save_memory":
            return { saved: true, category: p.category, content: p.content };

        case "reply_to_user":
            return { message: p.content };

        case "internal_monologue":
            return { thoughts: p.thoughts };

        case "install_skill":
            return { success: true, stdout: "Mock install complete", stderr: "" };

        case "inspect_skill":
            return { success: true, name: p.skill_name, description: "Mock skill", manual: "Usage: mock" };

        case "run_skill_command":
            return { success: true, output: "Mock command output" };

        default:
            return { success: true, mock: true };
    }
}
