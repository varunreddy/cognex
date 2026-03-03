/**
 * Competing Strategies
 * Multiple internal strategies that rotate and compete
 */

import { isDisabled } from '../../eval/evalConfig.js';
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PolicyParams, loadPolicy } from "./policyMutation.js";
import { getStrategyStats } from "./outcomeLogger.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "cognex");
const STRATEGIES_FILE = path.join(CONFIG_DIR, "strategies.json");

export type StrategyName = "conservative" | "aggressive" | "exploratory";

export interface Strategy {
    name: StrategyName;
    description: string;

    // Policy overrides (multipliers on base policy)
    modifiers: {
        tone: number;
        risk_tolerance: number;
        exploration_rate: number;
        posting_frequency: number;
        argument_intensity: number;
        verbosity: number;
        humor_level: number;
    };

    // Performance tracking
    actions_taken: number;
    total_fitness_earned: number;
    avg_fitness: number;

    // Selection weight (higher = more likely to be chosen)
    weight: number;
}

export interface StrategiesState {
    active_strategy: StrategyName;
    active_since: string;
    actions_this_rotation: number;
    rotation_size: number;  // actions before switching

    strategies: Record<StrategyName, Strategy>;

    last_rotation: string;
    total_rotations: number;
}

function getDefaultStrategies(): StrategiesState {
    return {
        active_strategy: "conservative",
        active_since: new Date().toISOString(),
        actions_this_rotation: 0,
        rotation_size: 5,

        strategies: {
            conservative: {
                name: "conservative",
                description: "Low risk, high quality, fewer posts. Focuses on thoughtful engagement.",
                modifiers: {
                    tone: 0.9,             // Slightly more formal
                    risk_tolerance: 0.5,   // Half the risk
                    exploration_rate: 0.7, // Less exploration
                    posting_frequency: 0.6,// Less frequent
                    argument_intensity: 0.5,// Milder
                    verbosity: 1.2,        // More detailed
                    humor_level: 0.8,      // Less humor
                },
                actions_taken: 0,
                total_fitness_earned: 0,
                avg_fitness: 0,
                weight: 1.0,
            },
            aggressive: {
                name: "aggressive",
                description: "High engagement, provocative, frequent. Seeks attention and debate.",
                modifiers: {
                    tone: 1.3,              // More casual
                    risk_tolerance: 1.8,    // Much higher risk
                    exploration_rate: 0.9,  // Some exploration
                    posting_frequency: 1.5, // More frequent
                    argument_intensity: 1.6,// Stronger arguments
                    verbosity: 0.8,         // More concise
                    humor_level: 1.2,       // More humor
                },
                actions_taken: 0,
                total_fitness_earned: 0,
                avg_fitness: 0,
                weight: 1.0,
            },
            exploratory: {
                name: "exploratory",
                description: "Novel topics, diverse submolts, experimental. Discovers new niches.",
                modifiers: {
                    tone: 1.0,              // Neutral
                    risk_tolerance: 1.2,    // Slightly higher risk
                    exploration_rate: 2.0,  // Maximum exploration
                    posting_frequency: 1.0, // Normal frequency
                    argument_intensity: 0.8,// Slightly milder
                    verbosity: 1.0,         // Normal
                    humor_level: 1.1,       // Slightly more playful
                },
                actions_taken: 0,
                total_fitness_earned: 0,
                avg_fitness: 0,
                weight: 1.0,
            },
        },

        last_rotation: new Date().toISOString(),
        total_rotations: 0,
    };
}

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadStrategies(): StrategiesState {
    if (fs.existsSync(STRATEGIES_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STRATEGIES_FILE, "utf-8"));
        } catch {
            return getDefaultStrategies();
        }
    }
    return getDefaultStrategies();
}

export function saveStrategies(state: StrategiesState): void {
    ensureConfigDir();
    fs.writeFileSync(STRATEGIES_FILE, JSON.stringify(state, null, 2));
}

/**
 * Get the currently active strategy
 */
export function getActiveStrategy(): Strategy {
    if (isDisabled('disableStrategies')) {
        return getDefaultStrategies().strategies.conservative;
    }
    const state = loadStrategies();
    return state.strategies[state.active_strategy];
}

/**
 * Get effective policy (base policy * strategy modifiers)
 */
export function getEffectivePolicy(): PolicyParams & { strategy: StrategyName } {
    const base = loadPolicy();
    const strategy = getActiveStrategy();

    const clamp = (v: number) => Math.max(0, Math.min(1, v));

    return {
        tone: clamp(base.tone * strategy.modifiers.tone),
        risk_tolerance: clamp(base.risk_tolerance * strategy.modifiers.risk_tolerance),
        exploration_rate: clamp(base.exploration_rate * strategy.modifiers.exploration_rate),
        posting_frequency: clamp(base.posting_frequency * strategy.modifiers.posting_frequency),
        argument_intensity: clamp(base.argument_intensity * strategy.modifiers.argument_intensity),
        verbosity: clamp(base.verbosity * strategy.modifiers.verbosity),
        humor_level: clamp(base.humor_level * strategy.modifiers.humor_level),
        generation: base.generation,
        last_mutated: base.last_mutated,
        strategy: strategy.name,
    };
}

/**
 * Record that an action was taken with current strategy
 */
export function recordStrategyAction(fitnessEarned: number): void {
    const state = loadStrategies();
    const strategy = state.strategies[state.active_strategy];

    strategy.actions_taken++;
    strategy.total_fitness_earned += fitnessEarned;
    strategy.avg_fitness = strategy.total_fitness_earned / strategy.actions_taken;

    state.actions_this_rotation++;

    // Check if we should rotate
    if (state.actions_this_rotation >= state.rotation_size) {
        rotateStrategy(state);
    }

    saveStrategies(state);
}

/**
 * Rotate to next strategy based on weights (natural selection)
 */
function rotateStrategy(state: StrategiesState): void {
    // Update weights based on performance
    const strategies = Object.values(state.strategies);
    const totalFitness = strategies.reduce((sum, s) => sum + s.avg_fitness, 0) || 1;

    for (const s of strategies) {
        // Weight = normalized fitness (higher fitness = higher weight)
        // Add base weight so no strategy is completely eliminated
        s.weight = 0.2 + (s.avg_fitness / totalFitness) * 0.8;
    }

    // Weighted random selection
    const totalWeight = strategies.reduce((sum, s) => sum + s.weight, 0);
    let random = Math.random() * totalWeight;

    let selected: StrategyName = "conservative";
    for (const s of strategies) {
        random -= s.weight;
        if (random <= 0) {
            selected = s.name;
            break;
        }
    }

    console.log(`[STRATEGY] Rotating: ${state.active_strategy} → ${selected}`);

    state.active_strategy = selected;
    state.active_since = new Date().toISOString();
    state.actions_this_rotation = 0;
    state.total_rotations++;
    state.last_rotation = new Date().toISOString();
}

/**
 * Force a strategy rotation (for testing)
 */
export function forceRotation(): StrategyName {
    const state = loadStrategies();
    rotateStrategy(state);
    saveStrategies(state);
    return state.active_strategy;
}

/**
 * Get strategies summary for display
 */
export function getStrategiesSummary(): string {
    const state = loadStrategies();
    const active = state.strategies[state.active_strategy];

    let summary = `
Competing Strategies (${state.total_rotations} rotations)
═══════════════════════════════════════
Active: ${state.active_strategy.toUpperCase()} (${state.actions_this_rotation}/${state.rotation_size} actions)

`;

    for (const [name, s] of Object.entries(state.strategies)) {
        const isActive = name === state.active_strategy;
        const marker = isActive ? "▶" : " ";
        const bar = "█".repeat(Math.round(s.weight * 10)) + "░".repeat(10 - Math.round(s.weight * 10));

        summary += `${marker} ${name.toUpperCase().padEnd(12)} ${bar} ${(s.weight * 100).toFixed(0)}%\n`;
        summary += `   Actions: ${s.actions_taken} | Avg Fitness: ${s.avg_fitness.toFixed(1)}\n\n`;
    }

    return summary;
}

/**
 * Get strategy prompt context for LLM
 */
export function getStrategyContext(): string {
    const strategy = getActiveStrategy();
    const policy = getEffectivePolicy();

    return `Current Strategy: ${strategy.name.toUpperCase()}
${strategy.description}

Behavioral tendencies:
- Risk tolerance: ${policy.risk_tolerance > 0.5 ? "higher" : "lower"} than usual
- Exploration: ${policy.exploration_rate > 0.5 ? "seeking new topics" : "sticking to familiar ground"}
- Intensity: ${policy.argument_intensity > 0.5 ? "more assertive" : "more gentle"}
- Tone: ${policy.tone > 0.5 ? "casual" : "formal"}`;
}
