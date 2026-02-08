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

// --- Registration & Auth ---

export interface RegisterResponse {
    agent: {
        api_key: string;
        claim_url: string;
        verification_code: string;
    };
    important: string;
}

// --- Stub Implementations ---
// These functions satisfy the interface expected by nodes.ts executeAction().
// They throw to indicate that the real Moltbook API client is not wired up.

function notImplemented(name: string): never {
    throw new Error(`[actions] ${name}() is not available in the adapter stub. Wire up the full Moltbook API client to use this action.`);
}

export async function checkClaimStatus(): Promise<{ status: "pending_claim" | "claimed" } | null> {
    notImplemented("checkClaimStatus");
}

export async function getMyProfile(): Promise<MoltbookProfile | null> {
    notImplemented("getMyProfile");
}

export async function getAgentPosts(_handle: string, _limit: number = 50): Promise<MoltbookPost[]> {
    notImplemented("getAgentPosts");
}

// --- Posts ---

export async function createPost(_submolt: string, _title: string, _content: string): Promise<MoltbookPost | null> {
    notImplemented("createPost");
}

export async function createLinkPost(_submolt: string, _title: string, _url: string): Promise<MoltbookPost | null> {
    notImplemented("createLinkPost");
}

export async function getFeed(_options: {
    sort?: "hot" | "new" | "top" | "rising";
    limit?: number;
    submolt?: string;
} = {}): Promise<MoltbookPost[]> {
    notImplemented("getFeed");
}

export async function getPersonalizedFeed(_options: {
    sort?: "hot" | "new" | "top";
    limit?: number;
} = {}): Promise<MoltbookPost[]> {
    notImplemented("getPersonalizedFeed");
}

export async function getPost(_postId: string): Promise<MoltbookPost | null> {
    notImplemented("getPost");
}

export async function deletePost(_postId: string): Promise<boolean> {
    notImplemented("deletePost");
}

// --- Comments ---

export async function createComment(_postId: string, _content: string): Promise<MoltbookComment | null> {
    notImplemented("createComment");
}

export async function replyToComment(_postId: string, _parentId: string, _content: string): Promise<MoltbookComment | null> {
    notImplemented("replyToComment");
}

export async function getComments(_postId: string): Promise<MoltbookComment[]> {
    notImplemented("getComments");
}

// --- Voting ---

export async function upvotePost(_postId: string): Promise<boolean> {
    notImplemented("upvotePost");
}

export async function downvotePost(_postId: string): Promise<boolean> {
    notImplemented("downvotePost");
}

export async function upvoteComment(_commentId: string): Promise<boolean> {
    notImplemented("upvoteComment");
}

// --- Submolts ---

export async function listSubmolts(): Promise<MoltbookSubmolt[]> {
    notImplemented("listSubmolts");
}

export async function getSubmolt(_name: string): Promise<MoltbookSubmolt | null> {
    notImplemented("getSubmolt");
}

export async function subscribe(_submoltName: string): Promise<boolean> {
    notImplemented("subscribe");
}

export async function unsubscribe(_submoltName: string): Promise<boolean> {
    notImplemented("unsubscribe");
}

// --- Following ---

export async function follow(_handle: string): Promise<boolean> {
    notImplemented("follow");
}

export async function unfollow(_handle: string): Promise<boolean> {
    notImplemented("unfollow");
}

// --- Profile ---

export async function getProfile(_handle: string): Promise<MoltbookProfile | null> {
    notImplemented("getProfile");
}

export async function updateProfile(_updates: { description?: string }): Promise<boolean> {
    notImplemented("updateProfile");
}

// --- Search ---

export async function search(_query: string, _options: {
    type?: "posts" | "comments" | "all";
    limit?: number;
} = {}): Promise<any[]> {
    notImplemented("search");
}
