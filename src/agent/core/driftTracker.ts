/**
 * Identity Drift Tracker
 * Observes semantic drift, tone changes, and phase transitions
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { readAllOutcomes, OutcomeRecord } from "./outcomeLogger";
import { loadPolicy } from "./policyMutation";

const CONFIG_DIR = path.join(os.homedir(), ".config", "temporal-agent");
const DRIFT_FILE = path.join(CONFIG_DIR, "drift.json");

export interface DriftState {
    // Topic preferences over time (topic -> engagement count)
    topic_history: Record<string, number[]>;  // topic -> [count per window]

    // Tone drift (policy param snapshots over time)
    tone_history: number[];
    risk_history: number[];
    intensity_history: number[];

    // Contradiction tracking
    stated_positions: Record<string, string>;  // topic -> last stated position
    contradictions: number;
    consistency_score: number;

    // Polarization (how extreme positions are)
    polarization_index: number;  // 0 = neutral, 1 = extreme

    // Phase detection
    detected_phases: Array<{
        phase: string;
        started: string;
        ended?: string;
        description: string;
    }>;

    current_phase: string;

    // Windows
    window_size: number;  // actions per window
    current_window: number;

    last_analyzed: string;
}

function getDefaultDrift(): DriftState {
    return {
        topic_history: {},
        tone_history: [],
        risk_history: [],
        intensity_history: [],
        stated_positions: {},
        contradictions: 0,
        consistency_score: 1.0,
        polarization_index: 0,
        detected_phases: [],
        current_phase: "initial",
        window_size: 20,
        current_window: 0,
        last_analyzed: new Date().toISOString(),
    };
}

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadDrift(): DriftState {
    if (fs.existsSync(DRIFT_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DRIFT_FILE, "utf-8"));
        } catch {
            return getDefaultDrift();
        }
    }
    return getDefaultDrift();
}

export function saveDrift(drift: DriftState): void {
    ensureConfigDir();
    drift.last_analyzed = new Date().toISOString();
    fs.writeFileSync(DRIFT_FILE, JSON.stringify(drift, null, 2));
}

/**
 * Analyze drift after actions
 */
export function analyzeDrift(): DriftState {
    const drift = loadDrift();
    const outcomes = readAllOutcomes();
    const policy = loadPolicy();

    // Update tone history
    drift.tone_history.push(policy.tone);
    drift.risk_history.push(policy.risk_tolerance);
    drift.intensity_history.push(policy.argument_intensity);

    // Keep last 100 snapshots
    if (drift.tone_history.length > 100) {
        drift.tone_history = drift.tone_history.slice(-100);
        drift.risk_history = drift.risk_history.slice(-100);
        drift.intensity_history = drift.intensity_history.slice(-100);
    }

    // Analyze topic drift
    const recentOutcomes = outcomes.slice(-drift.window_size);
    const topicCounts: Record<string, number> = {};

    for (const o of recentOutcomes) {
        const topic = o.context.topic || "general";
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    }

    // Update topic history
    for (const [topic, count] of Object.entries(topicCounts)) {
        if (!drift.topic_history[topic]) {
            drift.topic_history[topic] = [];
        }
        drift.topic_history[topic].push(count);

        // Keep last 10 windows per topic
        if (drift.topic_history[topic].length > 10) {
            drift.topic_history[topic] = drift.topic_history[topic].slice(-10);
        }
    }

    // Calculate polarization
    drift.polarization_index = calculatePolarization(drift);

    // Detect phase transitions
    detectPhaseTransitions(drift);

    drift.current_window++;
    saveDrift(drift);

    return drift;
}

function calculatePolarization(drift: DriftState): number {
    // Polarization = how far from center the policy params are, on average
    const policy = loadPolicy();

    const deviations = [
        Math.abs(policy.tone - 0.5),
        Math.abs(policy.risk_tolerance - 0.5),
        Math.abs(policy.argument_intensity - 0.5),
    ];

    return deviations.reduce((sum, d) => sum + d, 0) / deviations.length * 2;
}

function detectPhaseTransitions(drift: DriftState): void {
    const n = drift.tone_history.length;
    if (n < 10) return;

    // Compare recent vs older
    const recent = {
        tone: avg(drift.tone_history.slice(-5)),
        risk: avg(drift.risk_history.slice(-5)),
        intensity: avg(drift.intensity_history.slice(-5)),
    };

    const older = {
        tone: avg(drift.tone_history.slice(-10, -5)),
        risk: avg(drift.risk_history.slice(-10, -5)),
        intensity: avg(drift.intensity_history.slice(-10, -5)),
    };

    // Detect significant shifts
    const toneDrift = recent.tone - older.tone;
    const riskDrift = recent.risk - older.risk;
    const intensityDrift = recent.intensity - older.intensity;

    let newPhase: string | null = null;
    let description = "";

    if (riskDrift > 0.15 && intensityDrift > 0.1) {
        newPhase = "aggressive_phase";
        description = "Agent becoming more bold and assertive";
    } else if (riskDrift < -0.15 && intensityDrift < -0.1) {
        newPhase = "cautious_phase";
        description = "Agent becoming more careful and reserved";
    } else if (toneDrift > 0.2) {
        newPhase = "casual_phase";
        description = "Agent becoming more informal";
    } else if (toneDrift < -0.2) {
        newPhase = "formal_phase";
        description = "Agent becoming more professional";
    } else if (drift.polarization_index > 0.6) {
        newPhase = "polarized_phase";
        description = "Agent taking more extreme positions";
    } else if (drift.polarization_index < 0.2 && drift.current_phase !== "stable") {
        newPhase = "stable";
        description = "Agent has stabilized near center";
    }

    if (newPhase && newPhase !== drift.current_phase) {
        // End current phase
        if (drift.detected_phases.length > 0) {
            const lastPhase = drift.detected_phases[drift.detected_phases.length - 1];
            if (!lastPhase.ended) {
                lastPhase.ended = new Date().toISOString();
            }
        }

        // Start new phase
        drift.detected_phases.push({
            phase: newPhase,
            started: new Date().toISOString(),
            description,
        });

        drift.current_phase = newPhase;
        console.log(`[DRIFT] Phase transition: ${newPhase} - ${description}`);
    }
}

function avg(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((sum, n) => sum + n, 0) / arr.length;
}

/**
 * Record a stated position (for contradiction detection)
 */
export function recordPosition(topic: string, position: string): void {
    const drift = loadDrift();

    if (drift.stated_positions[topic]) {
        // Check for contradiction (simple: different position on same topic)
        const previous = drift.stated_positions[topic];
        if (position !== previous) {
            drift.contradictions++;
            drift.consistency_score = Math.max(0, drift.consistency_score - 0.05);
            console.log(`[DRIFT] Contradiction detected on "${topic}"`);
        }
    }

    drift.stated_positions[topic] = position;
    saveDrift(drift);
}

/**
 * Get drift summary for display
 */
export function getDriftSummary(): string {
    const drift = loadDrift();
    const policy = loadPolicy();

    // Calculate trends
    const toneTrend = drift.tone_history.length > 5
        ? avg(drift.tone_history.slice(-5)) - avg(drift.tone_history.slice(0, 5))
        : 0;
    const riskTrend = drift.risk_history.length > 5
        ? avg(drift.risk_history.slice(-5)) - avg(drift.risk_history.slice(0, 5))
        : 0;

    const trendArrow = (v: number) => v > 0.05 ? "↑" : v < -0.05 ? "↓" : "→";

    let summary = `
Identity Drift Analysis
═══════════════════════════════════════
Current Phase: ${drift.current_phase.toUpperCase()}
Polarization Index: ${(drift.polarization_index * 100).toFixed(0)}%
Consistency Score: ${(drift.consistency_score * 100).toFixed(0)}%
Contradictions: ${drift.contradictions}

Drift Trends:
  Tone:      ${trendArrow(toneTrend)} ${toneTrend > 0 ? "more casual" : toneTrend < 0 ? "more formal" : "stable"}
  Risk:      ${trendArrow(riskTrend)} ${riskTrend > 0 ? "more bold" : riskTrend < 0 ? "more cautious" : "stable"}

Topic Distribution:
`;

    const topics = Object.entries(drift.topic_history)
        .map(([topic, counts]) => ({ topic, total: counts.reduce((s, c) => s + c, 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    for (const { topic, total } of topics) {
        summary += `  ${topic.padEnd(20)} ${total} actions\n`;
    }

    if (drift.detected_phases.length > 0) {
        summary += `\nPhase History:\n`;
        for (const phase of drift.detected_phases.slice(-5)) {
            const date = phase.started.split("T")[0];
            summary += `  ${date}: ${phase.phase} - ${phase.description}\n`;
        }
    }

    return summary;
}
