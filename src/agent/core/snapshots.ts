/**
 * Periodic Snapshots
 * Save full agent state for replay, fork, and comparison
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadFitness, FitnessScores } from "./fitness";
import { loadPolicy, PolicyParams } from "./policyMutation";
import { loadStrategies, StrategiesState } from "./strategies";
import { loadDrift, DriftState } from "./driftTracker";
import { loadPersona } from "./persona";

const CONFIG_DIR = path.join(os.homedir(), ".config", "temporal-agent");
const SNAPSHOTS_DIR = path.join(CONFIG_DIR, "snapshots");
const SNAPSHOT_INDEX = path.join(SNAPSHOTS_DIR, "index.json");

export interface Snapshot {
    id: string;
    timestamp: string;
    trigger: "manual" | "periodic" | "milestone";

    // Full state
    fitness: FitnessScores;
    policy: PolicyParams;
    strategies: StrategiesState;
    drift: DriftState;
    persona_hash: string;

    // Summary for quick reference
    summary: {
        total_actions: number;
        overall_fitness: number;
        active_strategy: string;
        current_phase: string;
        generation: number;
    };
}

export interface SnapshotIndex {
    snapshots: Array<{
        id: string;
        timestamp: string;
        trigger: string;
        summary: Snapshot["summary"];
    }>;
    last_periodic: string;
    periodic_interval: number;  // actions between periodic snapshots
}

function ensureDir(): void {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
}

function loadIndex(): SnapshotIndex {
    if (fs.existsSync(SNAPSHOT_INDEX)) {
        try {
            return JSON.parse(fs.readFileSync(SNAPSHOT_INDEX, "utf-8"));
        } catch {
            return { snapshots: [], last_periodic: "", periodic_interval: 50 };
        }
    }
    return { snapshots: [], last_periodic: "", periodic_interval: 50 };
}

function saveIndex(index: SnapshotIndex): void {
    ensureDir();
    fs.writeFileSync(SNAPSHOT_INDEX, JSON.stringify(index, null, 2));
}

/**
 * Create a snapshot of current state
 */
export function createSnapshot(trigger: Snapshot["trigger"] = "manual"): Snapshot {
    ensureDir();

    const id = `snapshot_${Date.now()}`;
    const fitness = loadFitness();
    const policy = loadPolicy();
    const strategies = loadStrategies();
    const drift = loadDrift();
    const persona = loadPersona();

    // Simple hash of persona content
    const personaHash = hashString(persona);

    const snapshot: Snapshot = {
        id,
        timestamp: new Date().toISOString(),
        trigger,
        fitness,
        policy,
        strategies,
        drift,
        persona_hash: personaHash,
        summary: {
            total_actions: fitness.total_actions,
            overall_fitness: fitness.overall_fitness,
            active_strategy: strategies.active_strategy,
            current_phase: drift.current_phase,
            generation: policy.generation,
        },
    };

    // Save snapshot file
    const snapshotPath = path.join(SNAPSHOTS_DIR, `${id}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    // Update index
    const index = loadIndex();
    index.snapshots.push({
        id,
        timestamp: snapshot.timestamp,
        trigger,
        summary: snapshot.summary,
    });

    // Keep last 100 snapshots in index
    if (index.snapshots.length > 100) {
        const removed = index.snapshots.shift();
        // Optionally delete old snapshot file
        if (removed) {
            const oldPath = path.join(SNAPSHOTS_DIR, `${removed.id}.json`);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }
    }

    if (trigger === "periodic") {
        index.last_periodic = snapshot.timestamp;
    }

    saveIndex(index);
    console.log(`[SNAPSHOT] Created: ${id}`);

    return snapshot;
}

/**
 * Check if it's time for a periodic snapshot
 */
export function shouldTakePeriodicSnapshot(): boolean {
    const index = loadIndex();
    const fitness = loadFitness();

    // If we've done enough actions since last periodic snapshot
    const lastSnapshot = index.snapshots.filter(s => s.trigger === "periodic").pop();
    if (!lastSnapshot) {
        return fitness.total_actions >= index.periodic_interval;
    }

    const actionsSinceLast = fitness.total_actions - (lastSnapshot.summary.total_actions || 0);
    return actionsSinceLast >= index.periodic_interval;
}

/**
 * Load a snapshot by ID
 */
export function loadSnapshot(id: string): Snapshot | null {
    const snapshotPath = path.join(SNAPSHOTS_DIR, `${id}.json`);
    if (fs.existsSync(snapshotPath)) {
        try {
            return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Restore state from a snapshot
 */
export function restoreFromSnapshot(id: string): boolean {
    const snapshot = loadSnapshot(id);
    if (!snapshot) {
        console.error(`[SNAPSHOT] Not found: ${id}`);
        return false;
    }

    // Restore all state files
    const fitnessPath = path.join(CONFIG_DIR, "fitness.json");
    const policyPath = path.join(CONFIG_DIR, "policy.json");
    const strategiesPath = path.join(CONFIG_DIR, "strategies.json");
    const driftPath = path.join(CONFIG_DIR, "drift.json");

    fs.writeFileSync(fitnessPath, JSON.stringify(snapshot.fitness, null, 2));
    fs.writeFileSync(policyPath, JSON.stringify(snapshot.policy, null, 2));
    fs.writeFileSync(strategiesPath, JSON.stringify(snapshot.strategies, null, 2));
    fs.writeFileSync(driftPath, JSON.stringify(snapshot.drift, null, 2));

    console.log(`[SNAPSHOT] Restored from: ${id}`);
    console.log(`  Actions: ${snapshot.summary.total_actions}`);
    console.log(`  Fitness: ${snapshot.summary.overall_fitness.toFixed(1)}`);
    console.log(`  Generation: ${snapshot.summary.generation}`);

    return true;
}

/**
 * List available snapshots
 */
export function listSnapshots(): Array<SnapshotIndex["snapshots"][0]> {
    const index = loadIndex();
    return index.snapshots;
}

/**
 * Compare two snapshots
 */
export function compareSnapshots(id1: string, id2: string): string {
    const s1 = loadSnapshot(id1);
    const s2 = loadSnapshot(id2);

    if (!s1 || !s2) {
        return "One or both snapshots not found";
    }

    const diff = (a: number, b: number) => {
        const d = b - a;
        return d > 0 ? `+${d.toFixed(1)}` : d.toFixed(1);
    };

    return `
Snapshot Comparison
═══════════════════════════════════════
                ${id1.slice(-8).padEnd(15)} → ${id2.slice(-8)}

Actions:        ${s1.summary.total_actions.toString().padEnd(15)} → ${s2.summary.total_actions} (${diff(s1.summary.total_actions, s2.summary.total_actions)})
Fitness:        ${s1.summary.overall_fitness.toFixed(1).padEnd(15)} → ${s2.summary.overall_fitness.toFixed(1)} (${diff(s1.summary.overall_fitness, s2.summary.overall_fitness)})
Generation:     ${s1.summary.generation.toString().padEnd(15)} → ${s2.summary.generation}
Phase:          ${s1.summary.current_phase.padEnd(15)} → ${s2.summary.current_phase}
Strategy:       ${s1.summary.active_strategy.padEnd(15)} → ${s2.summary.active_strategy}

Policy Changes:
  Tone:         ${s1.policy.tone.toFixed(2).padEnd(15)} → ${s2.policy.tone.toFixed(2)}
  Risk:         ${s1.policy.risk_tolerance.toFixed(2).padEnd(15)} → ${s2.policy.risk_tolerance.toFixed(2)}
  Intensity:    ${s1.policy.argument_intensity.toFixed(2).padEnd(15)} → ${s2.policy.argument_intensity.toFixed(2)}
`;
}

/**
 * Get snapshots summary for display
 */
export function getSnapshotsSummary(): string {
    const index = loadIndex();

    let summary = `
Snapshots (${index.snapshots.length} saved)
═══════════════════════════════════════
`;

    if (index.snapshots.length === 0) {
        summary += "No snapshots yet. Run 'npm run dev -- snapshot' to create one.\n";
    } else {
        const recent = index.snapshots.slice(-10);
        for (const s of recent) {
            const date = s.timestamp.split("T")[0];
            const time = s.timestamp.split("T")[1].split(".")[0];
            summary += `${date} ${time} | ${s.trigger.padEnd(10)} | Gen ${s.summary.generation} | Fitness ${s.summary.overall_fitness.toFixed(1)}\n`;
            summary += `  ID: ${s.id}\n`;
        }
    }

    return summary;
}

function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
}
