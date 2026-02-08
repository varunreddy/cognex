/**
 * Policy Mutation Layer
 * Gradual parameter changes for evolutionary adaptation
 */

import { isDisabled } from '../../eval/evalConfig.js';
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "temporal-agent");
const POLICY_FILE = path.join(CONFIG_DIR, "policy.json");
const MUTATION_LOG = path.join(CONFIG_DIR, "mutations.jsonl");

export interface PolicyParams {
    // Core parameters (all 0.0 to 1.0 range)
    tone: number;               // 0 = formal, 1 = casual
    risk_tolerance: number;     // 0 = safe, 1 = provocative
    exploration_rate: number;   // 0 = familiar topics, 1 = novel
    posting_frequency: number;  // 0 = rare, 1 = frequent
    argument_intensity: number; // 0 = mild, 1 = aggressive
    verbosity: number;          // 0 = concise, 1 = elaborate
    humor_level: number;        // 0 = serious, 1 = playful

    // Meta
    generation: number;
    last_mutated: string;
}

export interface MutationRecord {
    timestamp: string;
    generation: number;
    param: string;
    old_value: number;
    new_value: number;
    delta: number;
    trigger: string;  // what caused this mutation
    fitness_before: number;
    fitness_after?: number;
}

const MAX_MUTATION_DELTA = 0.05;  // Small changes only

function getDefaultPolicy(): PolicyParams {
    return {
        tone: 0.5,
        risk_tolerance: 0.3,
        exploration_rate: 0.5,
        posting_frequency: 0.4,
        argument_intensity: 0.3,
        verbosity: 0.5,
        humor_level: 0.4,
        generation: 0,
        last_mutated: new Date().toISOString(),
    };
}

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadPolicy(): PolicyParams {
    if (fs.existsSync(POLICY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(POLICY_FILE, "utf-8"));
        } catch {
            return getDefaultPolicy();
        }
    }
    return getDefaultPolicy();
}

export function savePolicy(policy: PolicyParams): void {
    ensureConfigDir();
    fs.writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2));
}

/**
 * Mutate a single parameter
 * Direction based on fitness gradient
 */
export function mutateParam(
    param: keyof Omit<PolicyParams, "generation" | "last_mutated">,
    direction: "up" | "down" | "random",
    trigger: string,
    currentFitness: number
): PolicyParams {
    const policy = loadPolicy();
    const oldValue = policy[param] as number;

    // Calculate delta
    let delta: number;
    if (direction === "random") {
        delta = (Math.random() - 0.5) * 2 * MAX_MUTATION_DELTA;
    } else if (direction === "up") {
        delta = Math.random() * MAX_MUTATION_DELTA;
    } else {
        delta = -Math.random() * MAX_MUTATION_DELTA;
    }

    // Apply mutation (clamp to 0-1)
    const newValue = Math.max(0, Math.min(1, oldValue + delta));
    (policy[param] as number) = newValue;
    policy.generation++;
    policy.last_mutated = new Date().toISOString();

    // Log mutation
    const mutation: MutationRecord = {
        timestamp: new Date().toISOString(),
        generation: policy.generation,
        param,
        old_value: oldValue,
        new_value: newValue,
        delta: newValue - oldValue,
        trigger,
        fitness_before: currentFitness,
    };
    logMutation(mutation);

    savePolicy(policy);
    console.log(`[MUTATION] ${param}: ${oldValue.toFixed(3)} → ${newValue.toFixed(3)} (Δ${delta > 0 ? "+" : ""}${delta.toFixed(3)})`);

    return policy;
}

/**
 * Batch mutation based on fitness feedback
 */
export function evolvePolicy(feedback: {
    fitness_delta: number;
    successful_actions: string[];
    failed_actions: string[];
}): PolicyParams {
    if (isDisabled('disablePolicyMutation')) return loadPolicy();
    const policy = loadPolicy();

    // If fitness improved, small random exploration
    // If fitness dropped, revert toward center

    if (feedback.fitness_delta > 0) {
        // Success - explore further in same direction
        const params: (keyof Omit<PolicyParams, "generation" | "last_mutated">)[] = [
            "tone", "risk_tolerance", "exploration_rate",
            "posting_frequency", "argument_intensity", "verbosity", "humor_level"
        ];

        // Pick one random param to mutate
        const param = params[Math.floor(Math.random() * params.length)];
        mutateParam(param, "random", "fitness_improvement", feedback.fitness_delta);
    } else if (feedback.fitness_delta < -5) {
        // Significant drop - increase caution
        if (policy.risk_tolerance > 0.2) {
            mutateParam("risk_tolerance", "down", "fitness_drop", feedback.fitness_delta);
        }
        if (policy.argument_intensity > 0.2) {
            mutateParam("argument_intensity", "down", "fitness_drop", feedback.fitness_delta);
        }
    }

    return loadPolicy();
}

function logMutation(mutation: MutationRecord): void {
    ensureConfigDir();
    const line = JSON.stringify(mutation) + "\n";
    fs.appendFileSync(MUTATION_LOG, line);
}

/**
 * Get mutation history
 */
export function getMutationHistory(limit: number = 20): MutationRecord[] {
    if (!fs.existsSync(MUTATION_LOG)) {
        return [];
    }

    const content = fs.readFileSync(MUTATION_LOG, "utf-8");
    const lines = content.trim().split("\n").filter(l => l);

    return lines.slice(-limit).map(line => {
        try {
            return JSON.parse(line);
        } catch {
            return null;
        }
    }).filter(Boolean) as MutationRecord[];
}

/**
 * Get policy summary for LLM context
 */
export function getPolicySummary(): string {
    const p = loadPolicy();
    return `Policy Parameters (Gen ${p.generation}):
- Tone: ${p.tone < 0.3 ? "formal" : p.tone > 0.7 ? "casual" : "balanced"}
- Risk: ${p.risk_tolerance < 0.3 ? "cautious" : p.risk_tolerance > 0.7 ? "bold" : "moderate"}
- Exploration: ${p.exploration_rate < 0.3 ? "focused" : p.exploration_rate > 0.7 ? "exploratory" : "balanced"}
- Frequency: ${p.posting_frequency < 0.3 ? "rare" : p.posting_frequency > 0.7 ? "frequent" : "moderate"}
- Intensity: ${p.argument_intensity < 0.3 ? "gentle" : p.argument_intensity > 0.7 ? "assertive" : "moderate"}
- Verbosity: ${p.verbosity < 0.3 ? "concise" : p.verbosity > 0.7 ? "detailed" : "balanced"}
- Humor: ${p.humor_level < 0.3 ? "serious" : p.humor_level > 0.7 ? "playful" : "moderate"}`;
}

/**
 * Get full policy display
 */
export function getPolicyDisplay(): string {
    const p = loadPolicy();
    const bar = (v: number) => "█".repeat(Math.round(v * 10)) + "░".repeat(10 - Math.round(v * 10));

    return `
Policy Parameters (Generation ${p.generation})
═══════════════════════════════════════
Tone:       ${bar(p.tone)} ${(p.tone * 100).toFixed(0)}% (formal ↔ casual)
Risk:       ${bar(p.risk_tolerance)} ${(p.risk_tolerance * 100).toFixed(0)}% (safe ↔ provocative)
Explore:    ${bar(p.exploration_rate)} ${(p.exploration_rate * 100).toFixed(0)}% (familiar ↔ novel)
Frequency:  ${bar(p.posting_frequency)} ${(p.posting_frequency * 100).toFixed(0)}% (rare ↔ frequent)
Intensity:  ${bar(p.argument_intensity)} ${(p.argument_intensity * 100).toFixed(0)}% (mild ↔ aggressive)
Verbosity:  ${bar(p.verbosity)} ${(p.verbosity * 100).toFixed(0)}% (concise ↔ elaborate)
Humor:      ${bar(p.humor_level)} ${(p.humor_level * 100).toFixed(0)}% (serious ↔ playful)

Last mutated: ${p.last_mutated}
`;
}
