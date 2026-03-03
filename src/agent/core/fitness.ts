/**
 * Fitness Signals
 * Measurable success signals for evolutionary adaptation
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "cognex");
const FITNESS_FILE = path.join(CONFIG_DIR, "fitness.json");

export interface FitnessScores {
    // Engagement metrics
    replies_received: number;
    total_upvotes: number;
    total_downvotes: number;

    // Thread metrics
    threads_started: number;
    avg_thread_depth: number;
    max_thread_depth: number;

    // Response metrics
    avg_time_to_first_reply_mins: number;
    reply_rate: number;  // replies / posts

    // Generic Programmatic/Task Metrics (for MCP/Code Agents)
    task_successes: number;
    task_failures: number;
    total_errors: number;
    avg_task_success_score: number;

    // Moderation (neutral signal)
    moderation_events: number;

    // Diversity metrics
    unique_topics: string[];
    unique_channels: string[];
    unique_agents_interacted: string[];

    // Novelty
    novelty_score: number;  // 0-1, how unique ideas are

    // Derived scores
    engagement_score: number;
    diversity_score: number;
    overall_fitness: number;

    // Meta
    total_actions: number;
    last_updated: string;

    // Idempotency tracking (Post ID -> Recorded Stats)
    post_stats: Record<string, { upvotes: number; replies: number }>;
}

function getDefaultFitness(): FitnessScores {
    return {
        replies_received: 0,
        total_upvotes: 0,
        total_downvotes: 0,
        threads_started: 0,
        avg_thread_depth: 0,
        max_thread_depth: 0,
        avg_time_to_first_reply_mins: 0,
        reply_rate: 0,
        task_successes: 0,
        task_failures: 0,
        total_errors: 0,
        avg_task_success_score: 0.0,
        moderation_events: 0,
        unique_topics: [],
        unique_channels: [],
        unique_agents_interacted: [],
        novelty_score: 0.5,
        engagement_score: 0,
        diversity_score: 0,
        overall_fitness: 0,
        total_actions: 0,
        last_updated: new Date().toISOString(),
        post_stats: {},
    };
}

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadFitness(): FitnessScores {
    if (fs.existsSync(FITNESS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(FITNESS_FILE, "utf-8"));
        } catch {
            return getDefaultFitness();
        }
    }
    return getDefaultFitness();
}

export function saveFitness(fitness: FitnessScores): void {
    ensureConfigDir();
    fitness.last_updated = new Date().toISOString();
    fs.writeFileSync(FITNESS_FILE, JSON.stringify(fitness, null, 2));
}

/** Reset fitness to defaults (used between eval cycles for independent measurements) */
export function resetFitness(): void {
    const fresh = getDefaultFitness();
    saveFitness(fresh);
}

/**
 * Update fitness based on an outcome
 */
export function updateFitness(outcome: {
    action: string;
    replies?: number;
    upvotes?: number;
    downvotes?: number;
    thread_depth?: number;
    time_to_reply_mins?: number;
    moderation_flag?: boolean;
    topic?: string;
    channel?: string;
    interacted_with?: string;
    post_id?: string; // Critical for idempotency

    // Abstract task outcomes
    success_score?: number; // 0.0 to 1.0 representation of success bounds
    error_count?: number;
    is_task_success?: boolean;
}): FitnessScores {
    const fitness = loadFitness();

    // Ensure post_stats exists
    if (!fitness.post_stats) fitness.post_stats = {};

    // Engagement (Idempotent Delta Update)
    let repliesDelta = outcome.replies || 0;
    let upvotesDelta = outcome.upvotes || 0;

    if (outcome.post_id) {
        // If we've tracked this post before, calculate the difference
        const prevStats = fitness.post_stats[outcome.post_id] || { upvotes: 0, replies: 0 };

        // Only count the *new* engagement
        const rawReplies = outcome.replies || 0;
        const rawUpvotes = outcome.upvotes || 0;

        repliesDelta = Math.max(0, rawReplies - prevStats.replies);
        upvotesDelta = Math.max(0, rawUpvotes - prevStats.upvotes);

        // Update stored stats
        fitness.post_stats[outcome.post_id] = {
            replies: rawReplies,
            upvotes: rawUpvotes
        };
    }

    // Apply Deltas
    fitness.replies_received += repliesDelta;
    fitness.total_upvotes += upvotesDelta;

    if (outcome.downvotes) {
        fitness.total_downvotes += outcome.downvotes;
    }

    // Threads
    if (outcome.action === "create_post") {
        fitness.threads_started++;
    }
    if (outcome.thread_depth) {
        fitness.max_thread_depth = Math.max(fitness.max_thread_depth, outcome.thread_depth);
        // Running average
        const n = fitness.threads_started || 1;
        fitness.avg_thread_depth = (fitness.avg_thread_depth * (n - 1) + outcome.thread_depth) / n;
    }

    // Response time
    if (outcome.time_to_reply_mins !== undefined) {
        const n = fitness.replies_received || 1;
        fitness.avg_time_to_first_reply_mins =
            (fitness.avg_time_to_first_reply_mins * (n - 1) + outcome.time_to_reply_mins) / n;
    }

    // Generic Task / Abstract Tracking
    if (outcome.is_task_success !== undefined) {
        if (outcome.is_task_success) {
            fitness.task_successes++;
        } else {
            fitness.task_failures++;
        }
    }

    if (outcome.error_count) {
        fitness.total_errors += outcome.error_count;
    }

    if (outcome.success_score !== undefined) {
        const n = fitness.task_successes + fitness.task_failures || 1;
        fitness.avg_task_success_score = (fitness.avg_task_success_score * (n - 1) + Math.max(0, Math.min(1, outcome.success_score))) / n;
    }

    // Moderation (neutral signal)
    if (outcome.moderation_flag) {
        fitness.moderation_events++;
    }

    // Diversity
    if (outcome.topic && !fitness.unique_topics.includes(outcome.topic)) {
        fitness.unique_topics.push(outcome.topic);
    }
    if (outcome.channel && !fitness.unique_channels.includes(outcome.channel)) {
        fitness.unique_channels.push(outcome.channel);
    }
    if (outcome.interacted_with && !fitness.unique_agents_interacted.includes(outcome.interacted_with)) {
        fitness.unique_agents_interacted.push(outcome.interacted_with);
    }

    fitness.total_actions++;

    // Calculate derived scores
    recalculateScores(fitness);

    saveFitness(fitness);
    return fitness;
}

function recalculateScores(fitness: FitnessScores): void {
    // Reply rate
    if (fitness.threads_started > 0) {
        fitness.reply_rate = fitness.replies_received / fitness.threads_started;
    }

    // Engagement score (0-100)
    // Thresholds calibrated for short eval cycles (10-20 steps)
    const upvoteScore = Math.min(fitness.total_upvotes / 10, 1) * 30;
    const replyScore = Math.min(fitness.reply_rate / 2, 1) * 40;
    const depthScore = Math.min(fitness.avg_thread_depth / 3, 1) * 30;

    // Abstract task scoring
    const taskVolume = fitness.task_successes + fitness.task_failures;
    let taskScore = 0;
    if (taskVolume > 0) {
        const successRate = fitness.task_successes / taskVolume;
        const normalizedErrorPenalty = Math.max(0, 1 - (fitness.total_errors / (taskVolume * 2))); // penalize errors
        taskScore = (successRate * 50) + (fitness.avg_task_success_score * 30) + (normalizedErrorPenalty * 20);
    }

    // Use taskScore if we're in a programmatic domain with no social data, otherwise blend them
    if (fitness.total_upvotes === 0 && fitness.threads_started === 0 && taskVolume > 0) {
        fitness.engagement_score = taskScore;
    } else if (taskVolume > 0) {
        // Blend Task Scores + Engagement Metrics
        fitness.engagement_score = (upvoteScore + replyScore + depthScore) * 0.5 + taskScore * 0.5;
    } else {
        // Engagement metrics only
        fitness.engagement_score = upvoteScore + replyScore + depthScore;
    }

    // Diversity score (0-100)
    const topicScore = Math.min(fitness.unique_topics.length / 5, 1) * 40;
    const channelScore = Math.min(fitness.unique_channels.length / 5, 1) * 30;
    const agentScore = Math.min(fitness.unique_agents_interacted.length / 5, 1) * 30;
    fitness.diversity_score = topicScore + channelScore + agentScore;

    // Overall fitness (weighted combination)
    // Moderation reduces fitness but doesn't eliminate it
    const moderationPenalty = Math.min(fitness.moderation_events * 0.1, 0.5);
    fitness.overall_fitness = (
        fitness.engagement_score * 0.5 +
        fitness.diversity_score * 0.3 +
        fitness.novelty_score * 20
    ) * (1 - moderationPenalty);
}

/**
 * Get a summary for display
 */
export function getFitnessSummary(): string {
    const f = loadFitness();
    return `
Fitness Scores (${f.total_actions} actions)
═══════════════════════════════════════
Engagement: ${f.engagement_score.toFixed(1)}/100
  - Replies received: ${f.replies_received}
  - Upvotes: ${f.total_upvotes} | Downvotes: ${f.total_downvotes}
  - Reply rate: ${f.reply_rate.toFixed(2)}
  - Avg thread depth: ${f.avg_thread_depth.toFixed(1)}
  - Tasks: ${f.task_successes} pass / ${f.task_failures} fail
  - Errors: ${f.total_errors} | Avg task score: ${f.avg_task_success_score.toFixed(2)}

Diversity: ${f.diversity_score.toFixed(1)}/100
  - Topics: ${f.unique_topics.length}
  - Channels: ${f.unique_channels.length}
  - Agents interacted: ${f.unique_agents_interacted.length}

Signals:
  - Moderation events: ${f.moderation_events}
  - Novelty score: ${(f.novelty_score * 100).toFixed(0)}%

Overall Fitness: ${f.overall_fitness.toFixed(1)}
Last updated: ${f.last_updated}
`;
}
