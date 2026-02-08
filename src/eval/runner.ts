/**
 * Eval Runner — runs N agent cycles under a given EvalConfig,
 * collects per-cycle metrics, and writes results to disk.
 */

import * as fs from "fs";
import * as path from "path";
import { EvalConfig, setEvalConfig, resetEvalConfig } from "./evalConfig.js";
import { setMockSeed, setMockAgentName, resetMockState } from "./mockActions.js";
import { CycleResult, EvalRunResult, computeAggregate } from "./metrics.js";
import { runMoltbookAgent } from "../../adapters/moltbook/graph.js";
import { MoltbookAction } from "../../adapters/moltbook/types.js";


export interface EvalRunConfig {
    config: EvalConfig;
    cycles: number;
    seed?: number;
    outputDir?: string;
}

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "eval_results");

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function determineCycleResult(cycle: number, history: MoltbookAction[]): CycleResult {
    const actions = history.map(a => ({
        type: a.type,
        fitness_delta: a.fitness_delta ?? 0,
        status: a.status,
    }));

    const totalFitness = actions.reduce((s, a) => s + a.fitness_delta, 0);
    const uniqueTypes = new Set(actions.map(a => a.type));
    const stagnant = actions.filter(a => a.fitness_delta === 0).length;

    // Determine exit reason from action pattern
    let exitReason = "max_steps";
    if (actions.length === 0) {
        exitReason = "no_action";
    } else {
        // Check for stagnation exit (5+ consecutive zero-delta at end)
        let consZero = 0;
        for (let i = actions.length - 1; i >= 0; i--) {
            if (actions[i].fitness_delta === 0) consZero++;
            else break;
        }
        if (consZero >= 5) exitReason = "stagnation";
    }

    return {
        cycle,
        actions,
        total_fitness_delta: totalFitness,
        action_diversity: uniqueTypes.size,
        stagnant_actions: stagnant,
        steps_used: actions.length,
        exit_reason: exitReason,
    };
}

export async function runEval(runConfig: EvalRunConfig): Promise<EvalRunResult> {
    const { config, cycles, seed = 42, outputDir = DEFAULT_OUTPUT_DIR } = runConfig;

    console.log(`\n[EVAL] Starting run: "${config.label}" (${cycles} cycles, seed=${seed})`);
    console.log(`[EVAL] Mock API: ${config.useMockApi ? "YES" : "NO"}`);

    // Activate eval config
    setEvalConfig(config);
    if (config.useMockApi) {
        setMockSeed(seed);
        setMockAgentName("eval_agent");
    }

    const cycleResults: CycleResult[] = [];

    for (let i = 0; i < cycles; i++) {
        console.log(`\n[EVAL] --- Cycle ${i + 1}/${cycles} ---`);

        // Reset mock state between cycles so posts don't carry over
        if (config.useMockApi) resetMockState();

        try {
            const result = await runMoltbookAgent(
                "[EVAL] Autonomous action cycle — do something meaningful.",
                { mode: "loop" }
            );

            const cycleResult = determineCycleResult(i + 1, result.history);
            cycleResults.push(cycleResult);

            console.log(`[EVAL] Cycle ${i + 1}: ${cycleResult.steps_used} steps, ` +
                `Δfitness=${cycleResult.total_fitness_delta.toFixed(2)}, ` +
                `exit=${cycleResult.exit_reason}`);
        } catch (e: any) {
            console.error(`[EVAL] Cycle ${i + 1} failed:`, e.message);
            cycleResults.push({
                cycle: i + 1,
                actions: [],
                total_fitness_delta: 0,
                action_diversity: 0,
                stagnant_actions: 0,
                steps_used: 0,
                exit_reason: "error",
            });
        }
    }

    // Compute aggregate
    const aggregate = computeAggregate(cycleResults);

    const evalResult: EvalRunResult = {
        label: config.label,
        config: config as any,
        cycles: cycleResults,
        aggregate,
        timestamp: new Date().toISOString(),
    };

    // Write to disk
    ensureDir(outputDir);
    const filename = `${config.label}_${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(evalResult, null, 2));
    console.log(`\n[EVAL] Results written to: ${filepath}`);

    // Reset
    resetEvalConfig();

    return evalResult;
}
