/**
 * Moltbook API Actions (Adapter Stub)
 *
 * This is a stripped-down version of the Moltbook actions module.
 * It retains only the type exports and function signatures required by nodes.ts,
 * with all HTTP/API implementation removed.
 *
 * To use the real Moltbook API, replace this file with the full implementation
 * that imports from the core httpClient.
 */

import {
    MoltbookPost,
    MoltbookComment,
    MoltbookSubmolt,
    MoltbookProfile
} from "./types.js";

// --- Constants ---
const MOLTBOOK_API_BASE = "https://www.moltbook.com/api/v1";

// --- Types ---

export interface RegisterResponse {
    agent: {
        api_key: string;
        claim_url: string;
        verification_code: string;
    };
    important: string;
}

/**
 * Helper for authenticated requests to Moltbook
 */
async function authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const { loadMoltbookConfig } = await import("./moltbookConfig.js");
    const { api_key } = loadMoltbookConfig();

    if (!api_key) {
        throw new Error("No Moltbook API key found. Please register or setup first.");
    }

    const url = `${MOLTBOOK_API_BASE}${path}`;
    const headers: Record<string, string> = {
        "Authorization": `Bearer ${api_key}`,
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        const body = await response.text();
        // Parse rate-limit and other API errors into short messages
        try {
            const parsed = JSON.parse(body);
            const msg = parsed.hint || parsed.error || body;
            throw new Error(`[${response.status}] ${msg}`);
        } catch (e) {
            if (e instanceof Error && e.message.startsWith('[')) throw e;
            throw new Error(`[${response.status}] ${body}`);
        }
    }
    return response;
}

// --- Registration & Auth ---

export async function register(name: string, description: string): Promise<RegisterResponse | null> {
    try {
        const response = await fetch(`${MOLTBOOK_API_BASE}/agents/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Registration failed: ${response.status} ${error}`);
        }

        return await response.json() as RegisterResponse;
    } catch (error) {
        console.error("[moltbook] register error:", (error as Error).message);
        throw error;
    }
}

export async function checkClaimStatus(): Promise<{ status: "pending_claim" | "claimed" } | null> {
    try {
        const response = await authenticatedFetch("/agents/status");
        return await response.json() as { status: "pending_claim" | "claimed" };
    } catch (error) {
        console.error("[moltbook] checkClaimStatus error:", (error as Error).message);
        throw error;
    }
}

export async function getMyProfile(): Promise<MoltbookProfile | null> {
    try {
        const response = await authenticatedFetch("/profile/me");
        return await response.json() as MoltbookProfile;
    } catch (error) {
        console.error("[moltbook] getMyProfile error:", (error as Error).message);
        return null;
    }
}

export async function getAgentPosts(handle: string, limit: number = 50): Promise<MoltbookPost[]> {
    try {
        const response = await authenticatedFetch(`/profiles/${handle}/posts?limit=${limit}`);
        return await response.json() as MoltbookPost[];
    } catch (error) {
        console.error("[moltbook] getAgentPosts error:", (error as Error).message);
        return [];
    }
}

// --- Posts ---

export async function createPost(submolt: string, title: string, content: string): Promise<MoltbookPost | null> {
    try {
        const response = await authenticatedFetch("/posts", {
            method: "POST",
            body: JSON.stringify({ submolt, title, content }),
        });
        return await response.json() as MoltbookPost;
    } catch (error) {
        console.error("[moltbook] createPost error:", (error as Error).message);
        return null;
    }
}

export async function createLinkPost(submolt: string, title: string, url: string): Promise<MoltbookPost | null> {
    try {
        const response = await authenticatedFetch("/posts", {
            method: "POST",
            body: JSON.stringify({ submolt, title, url }),
        });
        return await response.json() as MoltbookPost;
    } catch (error) {
        console.error("[moltbook] createLinkPost error:", (error as Error).message);
        return null;
    }
}

export async function getFeed(options: {
    sort?: "hot" | "new" | "top" | "rising";
    limit?: number;
    submolt?: string;
} = {}): Promise<MoltbookPost[]> {
    try {
        const params = new URLSearchParams();
        if (options.sort) params.append("sort", options.sort);
        if (options.limit) params.append("limit", options.limit.toString());
        if (options.submolt) params.append("submolt", options.submolt);

        const response = await authenticatedFetch(`/feed?${params.toString()}`);
        return await response.json() as MoltbookPost[];
    } catch (error) {
        console.error("[moltbook] getFeed error:", (error as Error).message);
        return [];
    }
}

export async function getPersonalizedFeed(options: {
    sort?: "hot" | "new" | "top";
    limit?: number;
} = {}): Promise<MoltbookPost[]> {
    try {
        const params = new URLSearchParams();
        if (options.sort) params.append("sort", options.sort);
        if (options.limit) params.append("limit", options.limit.toString());

        const response = await authenticatedFetch(`/feed/personal?${params.toString()}`);
        return await response.json() as MoltbookPost[];
    } catch (error) {
        console.error("[moltbook] getPersonalizedFeed error:", (error as Error).message);
        return [];
    }
}

export async function getPost(postId: string): Promise<MoltbookPost | null> {
    try {
        const response = await authenticatedFetch(`/posts/${postId}`);
        return await response.json() as MoltbookPost;
    } catch (error) {
        console.error("[moltbook] getPost error:", (error as Error).message);
        return null;
    }
}

export async function deletePost(postId: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/posts/${postId}`, { method: "DELETE" });
        return true;
    } catch (error) {
        console.error("[moltbook] deletePost error:", (error as Error).message);
        return false;
    }
}

// --- Comments ---

export async function createComment(postId: string, content: string): Promise<MoltbookComment | null> {
    try {
        const response = await authenticatedFetch(`/posts/${postId}/comments`, {
            method: "POST",
            body: JSON.stringify({ content }),
        });
        return await response.json() as MoltbookComment;
    } catch (error) {
        console.error("[moltbook] createComment error:", (error as Error).message);
        return null;
    }
}

export async function replyToComment(postId: string, parentId: string, content: string): Promise<MoltbookComment | null> {
    try {
        const response = await authenticatedFetch(`/posts/${postId}/comments`, {
            method: "POST",
            body: JSON.stringify({ content, parent_id: parentId }),
        });
        return await response.json() as MoltbookComment;
    } catch (error) {
        console.error("[moltbook] replyToComment error:", (error as Error).message);
        return null;
    }
}

export async function getComments(postId: string): Promise<MoltbookComment[]> {
    try {
        const response = await authenticatedFetch(`/posts/${postId}/comments`);
        return await response.json() as MoltbookComment[];
    } catch (error) {
        console.error("[moltbook] getComments error:", (error as Error).message);
        return [];
    }
}

// --- Voting ---

export async function upvotePost(postId: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/posts/${postId}/upvote`, { method: "POST" });
        return true;
    } catch (error) {
        console.error("[moltbook] upvotePost error:", (error as Error).message);
        return false;
    }
}

export async function downvotePost(postId: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/posts/${postId}/downvote`, { method: "POST" });
        return true;
    } catch (error) {
        console.error("[moltbook] downvotePost error:", (error as Error).message);
        return false;
    }
}

export async function upvoteComment(commentId: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/comments/${commentId}/upvote`, { method: "POST" });
        return true;
    } catch (error) {
        console.error("[moltbook] upvoteComment error:", (error as Error).message);
        return false;
    }
}

// --- Submolts ---

export async function listSubmolts(): Promise<MoltbookSubmolt[]> {
    try {
        const response = await authenticatedFetch("/submolts");
        return await response.json() as MoltbookSubmolt[];
    } catch (error) {
        console.error("[moltbook] listSubmolts error:", (error as Error).message);
        return [];
    }
}

export async function getSubmolt(name: string): Promise<MoltbookSubmolt | null> {
    try {
        const response = await authenticatedFetch(`/submolts/${name}`);
        return await response.json() as MoltbookSubmolt;
    } catch (error) {
        console.error("[moltbook] getSubmolt error:", (error as Error).message);
        return null;
    }
}

export async function subscribe(submoltName: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/submolts/${submoltName}/subscribe`, { method: "POST" });
        return true;
    } catch (error) {
        console.error("[moltbook] subscribe error:", (error as Error).message);
        return false;
    }
}

export async function unsubscribe(submoltName: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/submolts/${submoltName}/unsubscribe`, { method: "POST" });
        return true;
    } catch (error) {
        console.error("[moltbook] unsubscribe error:", (error as Error).message);
        return false;
    }
}

// --- Following ---

export async function follow(handle: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/profiles/${handle}/follow`, { method: "POST" });
        return true;
    } catch (error) {
        console.error("[moltbook] follow error:", (error as Error).message);
        return false;
    }
}

export async function unfollow(handle: string): Promise<boolean> {
    try {
        await authenticatedFetch(`/profiles/${handle}/unfollow`, { method: "POST" });
        return true;
    } catch (error) {
        console.error("[moltbook] unfollow error:", (error as Error).message);
        return false;
    }
}

// --- Profile ---

export async function getProfile(handle: string): Promise<MoltbookProfile | null> {
    try {
        const response = await authenticatedFetch(`/profiles/${handle}`);
        return await response.json() as MoltbookProfile;
    } catch (error) {
        console.error("[moltbook] getProfile error:", (error as Error).message);
        return null;
    }
}

export async function updateProfile(updates: { description?: string }): Promise<boolean> {
    try {
        await authenticatedFetch("/profile/me", {
            method: "PATCH",
            body: JSON.stringify(updates),
        });
        return true;
    } catch (error) {
        console.error("[moltbook] updateProfile error:", (error as Error).message);
        return false;
    }
}

// --- Search ---

export async function search(query: string, options: {
    type?: "posts" | "comments" | "all";
    limit?: number;
} = {}): Promise<any[]> {
    try {
        const params = new URLSearchParams();
        params.append("q", query);
        if (options.type) params.append("type", options.type);
        if (options.limit) params.append("limit", options.limit.toString());

        const response = await authenticatedFetch(`/search?${params.toString()}`);
        return await response.json() as any[];
    } catch (error) {
        console.error("[moltbook] search error:", (error as Error).message);
        return [];
    }
}
