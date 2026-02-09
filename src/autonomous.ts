/**
 * Autonomous mode — self-directed agent loop.
 *
 * The agent runs indefinitely with a fixed interval between cycles
 * to avoid spamming. The agent's own memory and drive systems handle
 * all decision-making and continuity.
 */

import { runMoltbookAgent } from "../adapters/moltbook/graph.js";
import { loadDrives } from "./agent/core/drives.js";
import { checkAndPerformMaintenance } from "./agent/core/temporal/index.js";
import { resetEvalConfig } from "./eval/evalConfig.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutonomousOptions {
    intervalMs: number;  // default 60_000 (60s)
}

const DEFAULT_OPTIONS: AutonomousOptions = {
    intervalMs: 60_000,
};

// ---------------------------------------------------------------------------
// Interruptible sleep
// ---------------------------------------------------------------------------

export function interruptibleSleep(ms: number, shouldStop: () => boolean): Promise<void> {
    return new Promise((resolve) => {
        const start = Date.now();
        const tick = setInterval(() => {
            if (shouldStop() || Date.now() - start >= ms) {
                clearInterval(tick);
                resolve();
            }
        }, 1000);
    });
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min === 0) return `${sec}s`;
    return `${min}m ${sec}s`;
}

function formatUptime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Main autonomous loop
// ---------------------------------------------------------------------------

export async function runAutonomous(options: Partial<AutonomousOptions> = {}): Promise<void> {
    const opts: AutonomousOptions = { ...DEFAULT_OPTIONS, ...options };

    let shuttingDown = false;
    const shouldStop = () => shuttingDown;

    const shutdown = () => {
        if (!shuttingDown) {
            shuttingDown = true;
            console.log("\nShutdown signal received, finishing current cycle...");
        }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Ensure no eval flags are active
    resetEvalConfig();

    let cycleCount = 0;
    const startTime = Date.now();

    console.log("\n" + "=".repeat(60));
    console.log("  Autonomous Mode");
    console.log("=".repeat(60));
    console.log(`  Interval:  ${formatMs(opts.intervalMs)}`);
    console.log(`  Press Ctrl+C to stop gracefully`);
    console.log("=".repeat(60) + "\n");

    while (!shuttingDown) {
        cycleCount++;

        const drives = loadDrives();
        console.log(`--- Cycle ${cycleCount} ---`);
        console.log(`  Drives: social=${drives.social.toFixed(0)} curiosity=${drives.curiosity.toFixed(0)} competence=${drives.competence.toFixed(0)}`);

        try {
            const prompt = "You are in autonomous mode. Check your drives, review your memories, and decide what to do next. Act on whatever feels most pressing.";
            const result = await runMoltbookAgent(prompt, { mode: "loop" });

            const actions = result.history || [];
            if (actions.length > 0) {
                console.log(`  Actions: ${actions.length}`);
                for (const action of actions) {
                    console.log(`    - ${action.type}: ${action.status}`);
                }
            } else {
                console.log(`  No actions this cycle.`);
            }

            if (result.summary) {
                console.log(`  Summary: ${result.summary.summary_text}`);
            }
        } catch (error: any) {
            console.error(`  Error in cycle ${cycleCount}: ${error.message}`);
        }

        // Run maintenance (reflection + consolidation if due)
        try {
            const maintenance = await checkAndPerformMaintenance();
            if (maintenance.reflected) console.log(`  Maintenance: self-reflection completed`);
            if (maintenance.consolidated) console.log(`  Maintenance: memory consolidation completed`);
        } catch (error: any) {
            console.error(`  Maintenance error: ${error.message}`);
        }

        if (shuttingDown) break;

        console.log(`  Sleeping ${formatMs(opts.intervalMs)}...\n`);
        await interruptibleSleep(opts.intervalMs, shouldStop);
    }

    // Shutdown summary
    const uptime = Date.now() - startTime;
    const finalDrives = loadDrives();

    console.log("\n" + "=".repeat(60));
    console.log("  Autonomous Mode — Shutdown Summary");
    console.log("=".repeat(60));
    console.log(`  Total cycles:    ${cycleCount}`);
    console.log(`  Uptime:          ${formatUptime(uptime)}`);
    console.log(`  Final drives:    social=${finalDrives.social.toFixed(0)} curiosity=${finalDrives.curiosity.toFixed(0)} competence=${finalDrives.competence.toFixed(0)}`);
    console.log("=".repeat(60) + "\n");

    // Clean up handlers
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
}
