/**
 * Retrospective Analyzer — analyses existing outcomes.jsonl historically.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "temporal-agent");
const OUTCOMES_FILE = path.join(CONFIG_DIR, "outcomes.jsonl");
const FITNESS_FILE = path.join(CONFIG_DIR, "fitness.json");

interface OutcomeRecord {
    action: string;
    timestamp: string;
    context: {
        topic?: string;
        submolt?: string;
        post_id?: string;
        parent_author?: string;
        content_length?: number;
        strategy?: string;
    };
    outcomes: {
        replies?: number;
        upvotes?: number;
        downvotes?: number;
        moderation_flag?: boolean;
        engagement_score?: number;
    };
    active_strategy?: string;
    policy_params?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function readOutcomes(): OutcomeRecord[] {
    if (!fs.existsSync(OUTCOMES_FILE)) return [];
    const lines = fs.readFileSync(OUTCOMES_FILE, "utf-8").trim().split("\n").filter(Boolean);
    return lines
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean) as OutcomeRecord[];
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

export interface ActionDistributionWindow {
    window_start: string;
    window_end: string;
    counts: Record<string, number>;
    total: number;
}

export interface StrategyComparison {
    strategy: string;
    action_count: number;
    mean_upvotes: number;
    mean_replies: number;
    moderation_rate: number;
}

export interface RetrospectiveReport {
    total_outcomes: number;
    date_range: { first: string; last: string } | null;
    action_distribution: Record<string, number>;
    action_distribution_over_time: ActionDistributionWindow[];
    fitness_trajectory: { window: number; cumulative_upvotes: number; cumulative_replies: number }[];
    strategy_comparison: StrategyComparison[];
    stagnation_runs: { count: number; max_run: number; mean_run: number };
    topic_diversity_over_time: { window: number; unique_topics: number }[];
}

function computeActionDistribution(outcomes: OutcomeRecord[]): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const o of outcomes) {
        dist[o.action] = (dist[o.action] || 0) + 1;
    }
    return dist;
}

function computeActionDistributionOverTime(
    outcomes: OutcomeRecord[],
    windowSize: number = 50
): ActionDistributionWindow[] {
    const windows: ActionDistributionWindow[] = [];
    for (let i = 0; i < outcomes.length; i += windowSize) {
        const slice = outcomes.slice(i, i + windowSize);
        const counts: Record<string, number> = {};
        for (const o of slice) {
            counts[o.action] = (counts[o.action] || 0) + 1;
        }
        windows.push({
            window_start: slice[0].timestamp,
            window_end: slice[slice.length - 1].timestamp,
            counts,
            total: slice.length,
        });
    }
    return windows;
}

function computeFitnessTrajectory(
    outcomes: OutcomeRecord[],
    windowSize: number = 50
): { window: number; cumulative_upvotes: number; cumulative_replies: number }[] {
    const trajectory: { window: number; cumulative_upvotes: number; cumulative_replies: number }[] = [];
    let cumUp = 0;
    let cumRep = 0;
    for (let i = 0; i < outcomes.length; i += windowSize) {
        const slice = outcomes.slice(i, i + windowSize);
        for (const o of slice) {
            cumUp += o.outcomes.upvotes ?? 0;
            cumRep += o.outcomes.replies ?? 0;
        }
        trajectory.push({
            window: Math.floor(i / windowSize) + 1,
            cumulative_upvotes: cumUp,
            cumulative_replies: cumRep,
        });
    }
    return trajectory;
}

function computeStrategyComparison(outcomes: OutcomeRecord[]): StrategyComparison[] {
    const byStrategy = new Map<string, OutcomeRecord[]>();
    for (const o of outcomes) {
        const s = o.active_strategy || "unknown";
        if (!byStrategy.has(s)) byStrategy.set(s, []);
        byStrategy.get(s)!.push(o);
    }

    const comparisons: StrategyComparison[] = [];
    for (const [strategy, records] of byStrategy) {
        const totalUp = records.reduce((s, o) => s + (o.outcomes.upvotes ?? 0), 0);
        const totalRep = records.reduce((s, o) => s + (o.outcomes.replies ?? 0), 0);
        const modCount = records.filter(o => o.outcomes.moderation_flag).length;
        comparisons.push({
            strategy,
            action_count: records.length,
            mean_upvotes: records.length > 0 ? totalUp / records.length : 0,
            mean_replies: records.length > 0 ? totalRep / records.length : 0,
            moderation_rate: records.length > 0 ? modCount / records.length : 0,
        });
    }
    return comparisons.sort((a, b) => b.action_count - a.action_count);
}

function computeStagnationRuns(outcomes: OutcomeRecord[]): { count: number; max_run: number; mean_run: number } {
    // A "stagnation run" = consecutive outcomes with 0 upvotes AND 0 replies
    const runs: number[] = [];
    let currentRun = 0;
    for (const o of outcomes) {
        const up = o.outcomes.upvotes ?? 0;
        const rep = o.outcomes.replies ?? 0;
        if (up === 0 && rep === 0) {
            currentRun++;
        } else {
            if (currentRun > 0) runs.push(currentRun);
            currentRun = 0;
        }
    }
    if (currentRun > 0) runs.push(currentRun);

    return {
        count: runs.length,
        max_run: runs.length > 0 ? Math.max(...runs) : 0,
        mean_run: runs.length > 0 ? runs.reduce((s, v) => s + v, 0) / runs.length : 0,
    };
}

function computeTopicDiversity(
    outcomes: OutcomeRecord[],
    windowSize: number = 50
): { window: number; unique_topics: number }[] {
    const diversity: { window: number; unique_topics: number }[] = [];
    for (let i = 0; i < outcomes.length; i += windowSize) {
        const slice = outcomes.slice(i, i + windowSize);
        const topics = new Set(slice.map(o => o.context.topic).filter(Boolean));
        diversity.push({
            window: Math.floor(i / windowSize) + 1,
            unique_topics: topics.size,
        });
    }
    return diversity;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function runRetrospective(): RetrospectiveReport {
    const outcomes = readOutcomes();

    if (outcomes.length === 0) {
        console.log("[RETRO] No outcomes found at", OUTCOMES_FILE);
        return {
            total_outcomes: 0,
            date_range: null,
            action_distribution: {},
            action_distribution_over_time: [],
            fitness_trajectory: [],
            strategy_comparison: [],
            stagnation_runs: { count: 0, max_run: 0, mean_run: 0 },
            topic_diversity_over_time: [],
        };
    }

    console.log(`[RETRO] Analyzing ${outcomes.length} outcomes from ${OUTCOMES_FILE}`);

    const report: RetrospectiveReport = {
        total_outcomes: outcomes.length,
        date_range: {
            first: outcomes[0].timestamp,
            last: outcomes[outcomes.length - 1].timestamp,
        },
        action_distribution: computeActionDistribution(outcomes),
        action_distribution_over_time: computeActionDistributionOverTime(outcomes),
        fitness_trajectory: computeFitnessTrajectory(outcomes),
        strategy_comparison: computeStrategyComparison(outcomes),
        stagnation_runs: computeStagnationRuns(outcomes),
        topic_diversity_over_time: computeTopicDiversity(outcomes),
    };

    return report;
}

/** Print a human-readable summary to console */
export function printRetrospectiveSummary(report: RetrospectiveReport): void {
    console.log(`\n═══════════════════════════════════════`);
    console.log(`  Retrospective Analysis`);
    console.log(`═══════════════════════════════════════\n`);

    console.log(`Total outcomes: ${report.total_outcomes}`);
    if (report.date_range) {
        console.log(`Date range: ${report.date_range.first} → ${report.date_range.last}`);
    }

    console.log(`\n--- Action Distribution ---`);
    const sorted = Object.entries(report.action_distribution).sort((a, b) => b[1] - a[1]);
    for (const [action, count] of sorted) {
        const pct = ((count / report.total_outcomes) * 100).toFixed(1);
        console.log(`  ${action.padEnd(25)} ${count.toString().padStart(5)}  (${pct}%)`);
    }

    console.log(`\n--- Strategy Comparison ---`);
    for (const s of report.strategy_comparison) {
        console.log(`  ${s.strategy.padEnd(15)} | actions: ${s.action_count.toString().padStart(5)} | avg↑: ${s.mean_upvotes.toFixed(2)} | avg💬: ${s.mean_replies.toFixed(2)} | mod: ${(s.moderation_rate * 100).toFixed(1)}%`);
    }

    console.log(`\n--- Stagnation ---`);
    console.log(`  Runs of zero-outcome actions: ${report.stagnation_runs.count}`);
    console.log(`  Longest run: ${report.stagnation_runs.max_run}`);
    console.log(`  Mean run length: ${report.stagnation_runs.mean_run.toFixed(1)}`);

    console.log(`\n--- Topic Diversity (per 50-action window) ---`);
    for (const w of report.topic_diversity_over_time.slice(0, 10)) {
        console.log(`  Window ${w.window}: ${w.unique_topics} unique topics`);
    }
    if (report.topic_diversity_over_time.length > 10) {
        console.log(`  ... (${report.topic_diversity_over_time.length - 10} more windows)`);
    }

    console.log();
}
