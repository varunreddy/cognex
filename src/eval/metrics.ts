/**
 * Eval Metrics — aggregate statistics from eval run data.
 */

export interface CycleResult {
    cycle: number;
    actions: { type: string; fitness_delta: number; status: string }[];
    total_fitness_delta: number;
    action_diversity: number;
    stagnant_actions: number;
    steps_used: number;
    exit_reason: string;
}

export interface AggregateMetrics {
    total_cycles: number;
    mean_fitness_delta: number;
    median_fitness_delta: number;
    std_fitness_delta: number;
    mean_steps_used: number;
    mean_action_diversity: number;
    action_distribution: Record<string, number>;
    action_entropy: number;
    stagnation_rate: number;
    productive_action_rate: number;
    early_exit_rate: number;
    mean_stagnant_actions: number;
}

export interface EvalRunResult {
    label: string;
    config: Record<string, any>;
    cycles: CycleResult[];
    aggregate: AggregateMetrics;
    timestamp: string;
}

// ---------------------------------------------------------------------------
// Core computations
// ---------------------------------------------------------------------------

function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(arr: number[], mean: number): number {
    if (arr.length <= 1) return 0;
    const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
}

function shannonEntropy(distribution: Record<string, number>): number {
    const total = Object.values(distribution).reduce((s, v) => s + v, 0);
    if (total === 0) return 0;
    let entropy = 0;
    for (const count of Object.values(distribution)) {
        if (count === 0) continue;
        const p = count / total;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

const PRODUCTIVE_ACTIONS = new Set([
    "create_post", "create_link_post", "create_comment", "reply_comment", "upvote_post",
]);

export function computeAggregate(cycles: CycleResult[]): AggregateMetrics {
    if (cycles.length === 0) {
        return {
            total_cycles: 0, mean_fitness_delta: 0, median_fitness_delta: 0,
            std_fitness_delta: 0, mean_steps_used: 0, mean_action_diversity: 0,
            action_distribution: {}, action_entropy: 0, stagnation_rate: 0,
            productive_action_rate: 0, early_exit_rate: 0, mean_stagnant_actions: 0,
        };
    }

    const fitnessDeltas = cycles.map(c => c.total_fitness_delta);
    const meanFitness = fitnessDeltas.reduce((s, v) => s + v, 0) / fitnessDeltas.length;

    // Global action distribution
    const actionDist: Record<string, number> = {};
    let totalActions = 0;
    let productiveCount = 0;
    let stagnantTotal = 0;

    for (const cycle of cycles) {
        for (const a of cycle.actions) {
            actionDist[a.type] = (actionDist[a.type] || 0) + 1;
            totalActions++;
            if (PRODUCTIVE_ACTIONS.has(a.type)) productiveCount++;
            if (a.fitness_delta === 0) stagnantTotal++;
        }
    }

    const earlyExits = cycles.filter(c => c.exit_reason === "stagnation").length;

    return {
        total_cycles: cycles.length,
        mean_fitness_delta: meanFitness,
        median_fitness_delta: median(fitnessDeltas),
        std_fitness_delta: stdDev(fitnessDeltas, meanFitness),
        mean_steps_used: cycles.reduce((s, c) => s + c.steps_used, 0) / cycles.length,
        mean_action_diversity: cycles.reduce((s, c) => s + c.action_diversity, 0) / cycles.length,
        action_distribution: actionDist,
        action_entropy: shannonEntropy(actionDist),
        stagnation_rate: totalActions > 0 ? stagnantTotal / totalActions : 0,
        productive_action_rate: totalActions > 0 ? productiveCount / totalActions : 0,
        early_exit_rate: earlyExits / cycles.length,
        mean_stagnant_actions: cycles.reduce((s, c) => s + c.stagnant_actions, 0) / cycles.length,
    };
}

// ---------------------------------------------------------------------------
// Comparison helper
// ---------------------------------------------------------------------------

export interface ComparisonRow {
    label: string;
    [metric: string]: string | number;
}

export function compareRuns(runs: EvalRunResult[]): ComparisonRow[] {
    return runs.map(r => ({
        label: r.label,
        cycles: r.aggregate.total_cycles,
        mean_fitness: +r.aggregate.mean_fitness_delta.toFixed(3),
        median_fitness: +r.aggregate.median_fitness_delta.toFixed(3),
        std_fitness: +r.aggregate.std_fitness_delta.toFixed(3),
        mean_steps: +r.aggregate.mean_steps_used.toFixed(1),
        action_diversity: +r.aggregate.mean_action_diversity.toFixed(2),
        action_entropy: +r.aggregate.action_entropy.toFixed(3),
        stagnation_rate: +(r.aggregate.stagnation_rate * 100).toFixed(1),
        productive_rate: +(r.aggregate.productive_action_rate * 100).toFixed(1),
        early_exit_rate: +(r.aggregate.early_exit_rate * 100).toFixed(1),
    }));
}
