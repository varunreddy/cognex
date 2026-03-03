/**
 * Outcome Logger
 * Raw, non-judgmental logging of actions and outcomes
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "cognex");
const OUTCOMES_FILE = path.join(CONFIG_DIR, "outcomes.jsonl");

export interface OutcomeRecord {
    // What happened
    action: string;
    timestamp: string;

    // Context
    context: {
        topic?: string;
        category?: string;
        post_id?: string;
        parent_author?: string;
        content_length?: number;
        strategy?: string;
    };

    // Raw outcomes (no "good/bad" labels)
    outcomes: {
        replies?: number;
        upvotes?: number;
        downvotes?: number;
        moderation_flag?: boolean;
        thread_lifetime_hours?: number;
        time_to_first_reply_mins?: number;
        engagement_score?: number;
    };

    // Strategy that produced this
    active_strategy?: string;
    policy_params?: Record<string, any>;
}

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

/**
 * Log an outcome (append to JSONL file)
 */
export function logOutcome(record: OutcomeRecord): void {
    ensureConfigDir();

    // Add timestamp if not present
    if (!record.timestamp) {
        record.timestamp = new Date().toISOString();
    }

    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(OUTCOMES_FILE, line);

    console.log(`[OUTCOME] Logged: ${record.action}`);
}

/**
 * Read all outcomes
 */
export function readAllOutcomes(): OutcomeRecord[] {
    if (!fs.existsSync(OUTCOMES_FILE)) {
        return [];
    }

    const content = fs.readFileSync(OUTCOMES_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(l => l);

    return lines.map(line => {
        try {
            return JSON.parse(line);
        } catch {
            return null;
        }
    }).filter(Boolean) as OutcomeRecord[];
}

/**
 * Get recent outcomes
 */
export function getRecentOutcomes(limit: number = 20): OutcomeRecord[] {
    const all = readAllOutcomes();
    return all.slice(-limit);
}

/**
 * Get outcomes by strategy
 */
export function getOutcomesByStrategy(strategy: string): OutcomeRecord[] {
    return readAllOutcomes().filter(o => o.active_strategy === strategy);
}

/**
 * Calculate aggregate stats for a strategy
 */
export function getStrategyStats(strategy: string): {
    count: number;
    avg_replies: number;
    avg_upvotes: number;
    moderation_rate: number;
} {
    const outcomes = getOutcomesByStrategy(strategy);

    if (outcomes.length === 0) {
        return { count: 0, avg_replies: 0, avg_upvotes: 0, moderation_rate: 0 };
    }

    const totalReplies = outcomes.reduce((sum, o) => sum + (o.outcomes.replies || 0), 0);
    const totalUpvotes = outcomes.reduce((sum, o) => sum + (o.outcomes.upvotes || 0), 0);
    const moderationCount = outcomes.filter(o => o.outcomes.moderation_flag).length;

    return {
        count: outcomes.length,
        avg_replies: totalReplies / outcomes.length,
        avg_upvotes: totalUpvotes / outcomes.length,
        moderation_rate: moderationCount / outcomes.length,
    };
}

/**
 * Get outcomes summary for display
 */
export function getOutcomesSummary(): string {
    const outcomes = readAllOutcomes();
    const recent = outcomes.slice(-10);

    let summary = `
Outcome Log (${outcomes.length} total records)
═══════════════════════════════════════
`;

    if (recent.length === 0) {
        summary += "No outcomes recorded yet.\n";
    } else {
        summary += "Recent actions:\n";
        for (const o of recent) {
            const time = o.timestamp.split("T")[1].split(".")[0];
            const replies = o.outcomes.replies ?? "-";
            const upvotes = o.outcomes.upvotes ?? "-";
            const mod = o.outcomes.moderation_flag ? "⚠️" : "";
            summary += `  ${time} | ${o.action.padEnd(20)} | ↑${upvotes} 💬${replies} ${mod}\n`;
        }
    }

    return summary;
}
