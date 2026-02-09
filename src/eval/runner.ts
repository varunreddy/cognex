/**
 * Runs evaluation cycles with the agent.
 * 
 * This is pretty simple now - we just run N cycles with the agent and
 * record what happens. The main knobs are:
 * 
 *   --preset full|no-stm  - whether short-term memory is on
 *   --profile baseline|scoped  - whether agent gets specific tasks
 *   --mode independent|cumulative  - reset between cycles or not
 * 
 * Results get dumped to eval_results/ as JSON.
 */

import * as fs from "fs";
import * as path from "path";
import { EvalConfig, setEvalConfig, resetEvalConfig } from "./evalConfig.js";
import { setMockSeed, setMockAgentName, resetMockState } from "./mockActions.js";
import { resetFitness } from "../agent/core/fitness.js";
import { setMaxShortTermItems, resetMaxShortTermItems } from "../agent/core/temporal/shortTermContext.js";
import { getScopePrompt, getScopeForCycle } from "./taskScopes.js";
import { runMoltbookAgent } from "../../adapters/moltbook/graph.js";
import { MoltbookAction } from "../../adapters/moltbook/types.js";

export type EvalMode = "independent" | "cumulative";
export type EvalProfile = "baseline" | "scoped";

// what we track for each cycle - just the basics
export interface CycleResult {
    cycle: number;
    scope?: string;
    actions: { type: string; status: string }[];
    steps_used: number;
    exit_reason: string;
}

// the full output we save to disk
export interface EvalRunResult {
    label: string;
    config: Record<string, any>;
    mode: EvalMode;
    profile: EvalProfile;
    scope: string;
    cycles: CycleResult[];
    timestamp: string;
}

export interface EvalRunConfig {
    config: EvalConfig;
    cycles: number;
    seed?: number;
    mode?: EvalMode;
    outputDir?: string;
    scope?: string;
    maxSteps?: number;
    profile?: EvalProfile;
}

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "eval_results");

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// figure out what happened in a cycle based on the action history
function determineCycleResult(cycle: number, history: MoltbookAction[]): CycleResult {
    const actions = history.map(a => ({
        type: a.type,
        status: a.status,
    }));

    // if there's no actions, something went wrong or agent decided to do nothing
    let exitReason = "max_steps";
    if (actions.length === 0) {
        exitReason = "no_action";
    }

    return {
        cycle,
        actions,
        steps_used: actions.length,
        exit_reason: exitReason,
    };
}

export async function runEval(runConfig: EvalRunConfig): Promise<EvalRunResult> {
    const {
        config,
        cycles,
        seed = 42,
        mode = "independent",
        outputDir = DEFAULT_OUTPUT_DIR,
        scope,
        maxSteps = 10,
        profile = "baseline",
    } = runConfig;

    console.log(`\n[EVAL] Starting run: "${config.label}" (${cycles} cycles, mode=${mode}, profile=${profile})`);
    console.log(`[EVAL] STM: ${config.disableShortTermContext ? "DISABLED" : "ENABLED"}`);
    console.log(`[EVAL] Mock API: ${config.useMockApi ? "YES" : "NO"}`);

    // turn on eval mode with the given config
    setEvalConfig(config);
    if (config.stmSize != null) {
        setMaxShortTermItems(config.stmSize);
        console.log(`[EVAL] STM size override: ${config.stmSize}`);
    }
    if (config.useMockApi) {
        setMockSeed(seed);
        setMockAgentName("eval_agent");
    }

    // start fresh
    resetFitness();
    if (config.useMockApi) resetMockState();

    const cycleResults: CycleResult[] = [];
    const isInfinite = cycles === -1;
    const maxCycles = isInfinite ? Infinity : cycles;

    for (let i = 0; i < maxCycles; i++) {
        if (isInfinite) {
            console.log(`\n[EVAL] --- Iterative Cycle ${i + 1} (Continuous) ---`);
        } else {
            console.log(`\n[EVAL] --- Cycle ${i + 1}/${cycles} ---`);
        }

        // independent mode = each cycle is like a fresh start
        // cumulative mode = state builds up across cycles
        if (mode === "independent") {
            resetFitness();
            if (config.useMockApi) resetMockState();
        } else {
            // just reset the mock posts, keep everything else
            if (config.useMockApi) resetMockState();
        }

        try {
            const scopePrompt = getScopePrompt(scope, i);
            const currentScope = getScopeForCycle(scope, i);
            if (currentScope) {
                console.log(`[EVAL] Scope: ${currentScope.name}`);
            }

            const result = await runMoltbookAgent(scopePrompt, {
                mode: "loop",
                maxSteps,
                useScopeSelector: profile === "scoped",
            });

            const cycleResult = determineCycleResult(i + 1, result.history);
            if (currentScope) cycleResult.scope = currentScope.name;
            cycleResults.push(cycleResult);

            console.log(
                `[EVAL] Cycle ${i + 1}: ${cycleResult.steps_used} steps, ` +
                `exit=${cycleResult.exit_reason}`
            );
        } catch (e: any) {
            console.error(`[EVAL] Cycle ${i + 1} failed:`, e.message);
            cycleResults.push({
                cycle: i + 1,
                actions: [],
                steps_used: 0,
                exit_reason: "error",
            });
        }
    }

    const evalResult: EvalRunResult = {
        label: config.label,
        config: config as any,
        mode,
        profile,
        scope: scope || "generic",
        cycles: cycleResults,
        timestamp: new Date().toISOString(),
    };

    // save it
    ensureDir(outputDir);
    const filename = `${config.label}_${mode}_${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(evalResult, null, 2));
    console.log(`\n[EVAL] Results written to: ${filepath}`);

    // clean up
    resetEvalConfig();
    resetMaxShortTermItems();

    return evalResult;
}
