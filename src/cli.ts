/**
 * CLI entry point — unified command interface.
 *
 * Ported from the pre-restructure CLI with all agent, memory,
 * evolutionary, and eval commands intact.
 */

// --- Eval harness (simplified: STM/no-STM + scope/baseline) ---
import { runEval, EvalRunConfig, EvalMode, EvalProfile } from "./eval/runner.js";
import { getPreset, listPresets } from "./eval/evalConfig.js";

// --- Autonomous mode ---
import { runAutonomous } from "./autonomous.js";

// --- Agent core ---
import { runMoltbookAgent } from "../adapters/moltbook/graph.js";
import { loadPersona } from "./agent/core/persona.js";
import { loadMoltbookConfig, setupMoltbook, handleRegister, handleClaimStatus } from "../adapters/moltbook/moltbookConfig.js";
import { getFitnessSummary } from "./agent/core/fitness.js";
import { getStrategiesSummary, forceRotation } from "./agent/core/strategies.js";
import { getDriftSummary } from "./agent/core/driftTracker.js";
import { createSnapshot, getSnapshotsSummary, restoreFromSnapshot, listSnapshots } from "./agent/core/snapshots.js";
import { getPolicyDisplay } from "./agent/core/policyMutation.js";
import { setupLLM, getLLMConfigSummary } from "./agent/core/llmConfig.js";
import { loadDrives } from "./agent/core/drives.js";

// --- Temporal memory (high-level API) ---
import {
    getStats, searchMemories, triggerReflection, getActive, runConsolidation,
    resetMemorySystem, getShortTermInfo, runRecoverySequence,
} from "./agent/core/temporal/index.js";

// --- Temporal memory (low-level, for inspector) ---
import {
    getMemoryStats, getAllMemories, getRecentReflections, getShortTermContext, closeDatabase,
} from "./agent/core/temporal/memoryStore.js";

// --- Search agent ---
import { setupSearchAgent, printSearchAgentConfig, loadSearchAgentConfig } from "../adapters/search/searchConfig.js";

// --- Telegram ---
import { setupTelegramBot, startTelegramBot, loadTelegramConfig } from "../adapters/telegram/bot.js";

// ---------------------------------------------------------------------------
// Argument parsing (same pattern as old CLI)
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): { command: string; options: Record<string, string> } {
    const command = args[0] || "help";
    const options: Record<string, string> = {};

    for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const key = args[i].slice(2);
            const value = args[i + 1] || "";
            if (value && !value.startsWith("--")) {
                options[key] = value;
                i++;
            } else {
                options[key] = "true";
            }
        } else if (!args[i].startsWith("-")) {
            options["_prompt"] = options["_prompt"] ? `${options["_prompt"]} ${args[i]}` : args[i];
        }
    }

    return { command, options };
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printUsage(): void {
    console.log(`
temporal-agent-control — agent CLI

USAGE:
  npm run dev -- <command> [options]

COMMANDS:
  setup                            Configure LLM provider (interactive)
  config                           View current LLM configuration
  run "<prompt>" [--no-scope]      Run a single agent action
  loop [--cycles N] [--preset <name>] [--seed N] [--live]
                                   Run N eval cycles (default: 3, mock API)
  autonomous | auto [--interval S] [--scope]
                                   Run indefinitely (default: 60s interval, no scope)
  persona                          View agent persona

  === SEARCH AGENT ===
  search setup                     Configure search agent
  search config                    View search agent configuration

  === TELEGRAM ===
  telegram [setup]                 Start Telegram bot (or setup)

  === MEMORY SYSTEM ===
  memory stats                     View memory statistics
  memory search "<query>"          Search memories
  memory active                    View active short-term memories
  memory reflect                   Trigger self-reflection
  memory consolidate               Manual sleep/consolidation cycle
  memory recover "<context>"       Run memory recovery sequence
  memory reset                     Clear all memories (danger!)
  memories                         Inspect stored memories (detailed view)

  === EVOLUTIONARY ===
  fitness                          View fitness scores
  strategies                       View competing strategies
  drift                            View identity drift analysis
  policy                           View policy parameters
  snapshot                         Create a state snapshot
  snapshots                        List all snapshots
  restore --id <snapshot_id>       Restore from snapshot

  === EVALUATION (STM/no-STM modes) ===
  eval run [--cycles N] [--preset full|no-stm] [--mock] [--mode independent|cumulative] [--profile baseline|scoped] [--max-steps N]
                                   Run agent cycles with STM or no-STM mode
  eval presets                     List available presets (full, no-stm)
  presets                          (shortcut for eval presets)

  === ADAPTERS ===
  adapters                         List available adapters and setup status

  help                             Show this help

EXAMPLES:
  npm run dev -- setup
  npm run dev -- run "Check the latest posts"
  npm run dev -- loop --cycles 5 --preset no-stm
  npm run dev -- loop 3
  npm run dev -- memory stats
  npm run dev -- memory search "AI ethics"
  npm run dev -- autonomous
  npm run dev -- auto --interval 30 --scope
  npm run dev -- memories
  npm run dev -- fitness
  npm run dev -- eval run --preset full --cycles 3 --mock --profile scoped
`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimeSinceCreation(timestamp: string): string {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const ageMinutes = ageMs / (1000 * 60);
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageMinutes < 60) return `${Math.round(ageMinutes)}m ago`;
    if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
    return `${Math.round(ageDays)}d ago`;
}

// ---------------------------------------------------------------------------
// Eval run summary
// ---------------------------------------------------------------------------

function printRunSummary(result: { label: string; cycles: { steps_used: number; exit_reason: string }[]; mode: string; profile: string }): void {
    console.log("\n" + "=".repeat(60));
    console.log("  Run Summary");
    console.log("=".repeat(60));
    console.log(`  Preset:             ${result.label}`);
    console.log(`  Mode:               ${result.mode}`);
    console.log(`  Profile:            ${result.profile}`);
    console.log(`  Cycles:             ${result.cycles.length}`);
    const totalSteps = result.cycles.reduce((s, c) => s + c.steps_used, 0);
    console.log(`  Total steps:        ${totalSteps}`);
    console.log("=".repeat(60) + "\n");
}

// ---------------------------------------------------------------------------
// Memory inspector (detailed view)
// ---------------------------------------------------------------------------

function printMemories(): void {
    const stats = getMemoryStats();

    console.log("\n" + "=".repeat(60));
    console.log("  Temporal Memory Store");
    console.log("=".repeat(60));
    console.log(`  Total memories:     ${stats.total_memories}`);
    console.log(`    Episodic:         ${stats.episodic_count}`);
    console.log(`    Semantic:         ${stats.semantic_count}`);
    console.log(`    Procedural:       ${stats.procedural_count}`);
    console.log(`  Links:              ${stats.total_links} (avg weight: ${stats.avg_link_weight.toFixed(3)})`);
    console.log(`  Short-term active:  ${stats.short_term_active}`);
    console.log(`  Reflections:        ${stats.total_reflections}`);
    console.log(`  Last reflection:    ${stats.last_reflection ?? "never"}`);
    console.log("=".repeat(60));

    if (stats.total_memories === 0) {
        console.log("\n  No memories stored yet.\n");
        closeDatabase();
        return;
    }

    const memories = getAllMemories(20);
    console.log(`\n--- Recent Memories (newest first, up to 20) ---\n`);

    for (const mem of memories) {
        const truncated = mem.content.length > 120
            ? mem.content.slice(0, 120) + "..."
            : mem.content;
        const tags = mem.tags.length > 0 ? ` [${mem.tags.join(", ")}]` : "";
        const accessed = mem.access_count > 0
            ? `accessed ${mem.access_count}x, last ${mem.last_accessed}`
            : "never accessed";

        console.log(`  ${mem.type.padEnd(11)} | imp=${mem.importance.toFixed(2)} aro=${mem.arousal.toFixed(2)} | ${accessed}`);
        console.log(`             ${truncated}${tags}`);
        console.log(`             id: ${mem.id}  created: ${mem.created_at}`);
        console.log();
    }

    const stm = getShortTermContext();
    if (stm.length > 0) {
        console.log(`--- Short-Term Context (${stm.length} slots) ---\n`);
        for (const slot of stm) {
            console.log(`  ${slot.memory_id}  weight=${slot.retrieval_weight.toFixed(3)}  expires=${slot.expires_at}`);
        }
        console.log();
    }

    const reflections = getRecentReflections(3);
    if (reflections.length > 0) {
        console.log(`--- Recent Reflections (last ${reflections.length}) ---\n`);
        for (const r of reflections) {
            console.log(`  ${r.reflected_at} [${r.trigger}] (${r.duration_ms}ms)`);
            for (const insight of r.insights.slice(0, 3)) {
                console.log(`    - ${insight}`);
            }
            if (r.insights.length > 3) {
                console.log(`    ... +${r.insights.length - 3} more`);
            }
            console.log();
        }
    }

    closeDatabase();
}

// ---------------------------------------------------------------------------
// Memory subcommands (from old CLI)
// ---------------------------------------------------------------------------

async function handleMemory(options: Record<string, string>): Promise<void> {
    const subcommand = options._prompt?.split(" ")[0];

    switch (subcommand) {
        case "stats": {
            const stats = getStats();
            console.log(`\nMemory System Statistics\n`);
            console.log(`Total Memories:       ${stats.total_memories}`);
            console.log(`  Episodic:           ${stats.episodic_count}`);
            console.log(`  Semantic:           ${stats.semantic_count}`);
            console.log(`  Procedural:         ${stats.procedural_count}`);
            console.log(`\nMemory Graph:`);
            console.log(`  Total Links:        ${stats.total_links}`);
            console.log(`  Avg Link Weight:    ${stats.avg_link_weight.toFixed(2)}`);
            console.log(`\nShort-term Context:`);
            console.log(`  Active Memories:    ${stats.short_term_active}`);
            console.log(`\nReflection:`);
            console.log(`  Total Sessions:     ${stats.total_reflections}`);
            console.log(`  Last Reflection:    ${stats.last_reflection || "Never"}`);
            console.log();
            break;
        }

        case "search": {
            const query = options._prompt?.split(" ").slice(1).join(" ") || options.query || "";
            if (!query) {
                console.error("Error: search query required");
                console.log('Usage: npm run dev -- memory search "keyword or phrase"');
                process.exit(1);
            }

            console.log(`\nSearching memories for: "${query}"\n`);
            const results = await searchMemories(query, 10);

            if (results.length === 0) {
                console.log("No memories found.");
                break;
            }

            console.log(`Found ${results.length} memories:\n`);
            for (let i = 0; i < results.length; i++) {
                const { memory, activation } = results[i];
                const age = getTimeSinceCreation(memory.created_at);
                const bar = "\u2588".repeat(Math.round(activation * 10));
                console.log(`${i + 1}. [${bar.padEnd(10, "\u2591")}] (${age})`);
                console.log(`   ${memory.content}`);
                console.log(`   Type: ${memory.type} | Importance: ${memory.importance.toFixed(2)} | Access: ${memory.access_count}x`);
                console.log();
            }
            break;
        }

        case "active": {
            const active = getActive();
            console.log(`\nActive Short-term Context (${active.length} memories)\n`);

            if (active.length === 0) {
                console.log("No active memories in short-term context.");
                break;
            }

            for (const { memory, slot, strength } of active) {
                const age = getTimeSinceCreation(memory.created_at);
                const bar = "\u2588".repeat(Math.round(strength * 5));
                const ttlRemaining = Math.round(slot.ttl_seconds * strength);

                console.log(`[${bar.padEnd(5, "\u2591")}] Strength: ${(strength * 100).toFixed(0)}% | TTL: ${ttlRemaining}s`);
                console.log(`${memory.content}`);
                console.log(`  ${memory.type} | Created: ${age} | Accessed: ${memory.access_count}x`);
                console.log();
            }
            break;
        }

        case "reflect": {
            console.log("\nStarting self-reflection...\n");
            await triggerReflection();
            console.log("\nReflection complete\n");
            break;
        }

        case "consolidate": {
            console.log("\nStarting memory consolidation (Sleep Cycle)...");
            const result = await runConsolidation();
            console.log(`\nConsolidation complete:`);
            console.log(`   - Created ${result.semantics_created} semantic insights`);
            console.log(`   - Decayed ${result.memories_decayed} unaccessed memories`);
            console.log(`   - Pruned ${result.memories_pruned} stale episodics`);
            console.log(`   - Duration: ${result.duration_ms}ms\n`);
            break;
        }

        case "recover": {
            const context = options._prompt?.split(/\s+/).slice(1).join(" ") || "General recovery";
            console.log(`\nRunning Memory Recovery...`);
            console.log(`   Context: "${context}"`);
            const result = await runRecoverySequence(context);
            console.log(`\n${result}\n`);
            break;
        }

        case "reset": {
            resetMemorySystem();
            console.log("Memory system has been reset. All memories cleared.");
            break;
        }

        default:
            console.error("Unknown memory subcommand");
            console.log("Usage: memory [stats|search|active|reflect|consolidate|recover|reset]");
            break;
    }
}

// ---------------------------------------------------------------------------
// Adapters listing
// ---------------------------------------------------------------------------

function printAdaptersStatus(): void {
    const searchConfig = loadSearchAgentConfig();
    const telegramConfig = loadTelegramConfig();

    console.log("\n" + "=".repeat(60));
    console.log("  Environment Adapters");
    console.log("=".repeat(60));

    // Moltbook
    const moltbookConfig = loadMoltbookConfig();
    let moltbookStatus = "NOT CONFIGURED";
    let moltbookAction = "Run 'npm run dev -- moltbook setup'";

    if (moltbookConfig.api_key) {
        if (moltbookConfig.claimed) {
            moltbookStatus = "Configured (Active)";
            moltbookAction = "";
        } else {
            moltbookStatus = "PENDING CLAIM";
            moltbookAction = "Run 'npm run dev -- moltbook claim'";
        }
    }

    console.log(`\n[ moltbook ]`);
    console.log(`  Status:             ${moltbookStatus}`);
    if (moltbookAction) {
        console.log(`  Setup Action:       ${moltbookAction}`);
    }
    console.log(`  Documentation:      adapters/moltbook/README.md`);

    // Search
    const searchStatus = searchConfig.tavily_api_key ? "Configured" : "NOT CONFIGURED";
    console.log(`\n[ search ] (Tavily)`);
    console.log(`  Status:             ${searchStatus}`);
    if (!searchConfig.tavily_api_key) {
        console.log(`  Setup Action:       Run 'npm run dev -- search setup'`);
    }
    console.log(`  Documentation:      adapters/search/README.md`);

    // Telegram
    const telegramStatus = telegramConfig.bot_token ? "Configured" : "NOT CONFIGURED";
    console.log(`\n[ telegram ]`);
    console.log(`  Status:             ${telegramStatus}`);
    if (!telegramConfig.bot_token) {
        console.log(`  Setup Action:       Run 'npm run dev -- telegram setup'`);
    }
    console.log(`  Documentation:      adapters/telegram/README.md`);

    console.log("\n" + "=".repeat(60));
    console.log("  To run an agent action: npm run dev -- run \"...\"");
    console.log("=".repeat(60) + "\n");
}

// ---------------------------------------------------------------------------
// Loop command (was "heartbeat" — runs N eval cycles or continuous)
// ---------------------------------------------------------------------------

async function handleLoop(options: Record<string, string>): Promise<void> {
    const promptParts = options._prompt?.split(/\s+/) || [];

    // Support "loop <cycles> <preset> <seed>" positional format
    let cycles = parseInt(options.cycles || promptParts[0] || "3", 10);
    const presetName = options.preset || promptParts[1] || "full";
    const seed = parseInt(options.seed || promptParts[2] || "42", 10);
    const live = options.live === "true" || options._prompt?.includes("--live");

    // Continuous mode if --continuous or cycles=0
    if (options.continuous === "true" || options._prompt?.includes("--continuous") || cycles === 0) {
        cycles = -1; // -1 indicates infinite in runner
    }

    const config = getPreset(presetName);
    if (!config) {
        console.error(`Unknown preset: "${presetName}"`);
        console.error(`Available: ${listPresets().map(p => p.toLowerCase().replace(/_/g, "-")).join(", ")}`);
        process.exit(1);
    }

    if (!live) {
        config.useMockApi = true;
    }

    const runConfig: EvalRunConfig = {
        config,
        cycles,
        seed,
    };

    const result = await runEval(runConfig);
    printRunSummary(result);
}

// ---------------------------------------------------------------------------
// Eval command (umbrella for ablation experiments)
// ---------------------------------------------------------------------------

async function handleEval(options: Record<string, string>): Promise<void> {
    const subcommand = options._prompt?.split(" ")[0];

    switch (subcommand) {
        case "run": {
            // Parse flags from the _prompt tail and from named options
            const parts = options._prompt?.split(/\s+/) || [];
            let presetName = options.preset || "full";
            let cycles = parseInt(options.cycles || "3", 10);
            let seed = parseInt(options.seed || "42", 10);
            let useMock = options.mock === "true";
            let mode: EvalMode = (options.mode as EvalMode) || "independent";
            let stmSize: number | undefined = options["stm-size"] ? parseInt(options["stm-size"], 10) : undefined;
            let scope: string | undefined = options.scope;
            let maxSteps: number | undefined = options["max-steps"] ? parseInt(options["max-steps"], 10) : undefined;
            let profile: EvalProfile = (options.profile as EvalProfile) || "baseline";

            // Also parse inline flags from _prompt
            for (let i = 1; i < parts.length; i++) {
                if (parts[i] === "--preset" && parts[i + 1]) { presetName = parts[i + 1]; i++; }
                else if (parts[i] === "--cycles" && parts[i + 1]) { cycles = parseInt(parts[i + 1], 10); i++; }
                else if (parts[i] === "--seed" && parts[i + 1]) { seed = parseInt(parts[i + 1], 10); i++; }
                else if (parts[i] === "--mock") { useMock = true; }
                else if (parts[i] === "--mode" && parts[i + 1]) { mode = parts[i + 1] as EvalMode; i++; }
                else if (parts[i] === "--stm-size" && parts[i + 1]) { stmSize = parseInt(parts[i + 1], 10); i++; }
                else if (parts[i] === "--scope" && parts[i + 1]) { scope = parts[i + 1]; i++; }
                else if (parts[i] === "--profile" && parts[i + 1]) { profile = parts[i + 1] as EvalProfile; i++; }
                else if (parts[i] === "--max-steps" && parts[i + 1]) { maxSteps = parseInt(parts[i + 1], 10); i++; }
            }

            const config = getPreset(presetName);
            if (!config) {
                console.error(`Unknown preset: "${presetName}"`);
                console.log(`Available presets: ${listPresets().join(", ")}`);
                process.exit(1);
            }

            if (useMock) config.useMockApi = true;
            if (stmSize != null) {
                config.stmSize = stmSize;
                config.label = `${config.label}-stm${stmSize}`;
            }

            if (scope) {
                config.label = `${config.label}-scope-${scope}`;
            }

            const result = await runEval({ config, cycles, seed, mode, scope, maxSteps, profile });
            printRunSummary(result);
            break;
        }

        case "presets": {
            console.log("\nAvailable presets (STM modes):\n");
            console.log("  full     — STM enabled (long-term autonomous)");
            console.log("  no-stm   — STM disabled (short-term scoped)");
            console.log("\nProfiles:");
            console.log("  baseline — No scope constraints");
            console.log("  scoped   — Uses scope selector for focused behavior");
            console.log();
            break;
        }

        default:
            console.log("Eval subcommands: run, presets");
            console.log("  eval run [--cycles N] [--mock] [--preset full|no-stm] [--mode independent|cumulative] [--profile baseline|scoped] [--max-steps N]");
            console.log("  eval presets");
            console.log(`\nAvailable presets: ${listPresets().join(", ")}`);
            break;
    }
}

// ---------------------------------------------------------------------------
// Autonomous mode
// ---------------------------------------------------------------------------

async function handleAutonomous(options: Record<string, string>): Promise<void> {
    const interval = options["interval"]
        ? parseInt(options["interval"], 10) * 1000
        : undefined;

    const enableScope = options["scope"] === "true";

    await runAutonomous({
        ...(interval !== undefined && { intervalMs: interval }),
        enableScope,
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const { command, options } = parseArgs(args);

    try {
        switch (command) {
            // --- Agent core ---
            case "setup":
                await setupLLM();
                break;
            case "config":
                console.log(getLLMConfigSummary());
                break;
            case "run": {
                const prompt = options._prompt || options.prompt || "Check the latest posts on Moltbook";
                const noScope = options["no-scope"] === "true";
                console.log(`\nRunning: "${prompt}"\n`);
                const result = await runMoltbookAgent(prompt, {
                    useScopeSelector: !noScope,
                });
                if (result.summary) {
                    console.log(`\nStatus: ${result.summary.status}`);
                    console.log(`Summary: ${result.summary.summary_text}`);
                    if (result.summary.actions_taken.length > 0) {
                        console.log("\nActions taken:");
                        for (const action of result.summary.actions_taken) {
                            console.log(`   - ${action.type}: ${action.status}`);
                        }
                    }
                }
                break;
            }
            case "loop":
                await handleLoop(options);
                break;
            case "autonomous":
            case "auto":
                await handleAutonomous(options);
                break;
            case "persona":
                console.log("\nAgent Persona\n---");
                console.log(loadPersona());
                console.log("---\n");
                break;
            case "moltbook": {
                const prompt = options._prompt || "";
                if (prompt === "setup") await setupMoltbook();
                else if (prompt.startsWith("register")) await handleRegister(options);
                else if (prompt === "claim") await handleClaimStatus();
                else {
                    console.error("Unknown moltbook subcommand");
                    console.log("Usage: moltbook [setup|register|claim]");
                }
                break;
            }

            // --- Search ---
            case "search": {
                const sub = options._prompt;
                if (sub === "setup") await setupSearchAgent();
                else if (sub === "config") printSearchAgentConfig();
                else {
                    console.error("Unknown search subcommand");
                    console.log("Usage: search [setup|config]");
                }
                break;
            }

            // --- Telegram ---
            case "telegram": {
                const sub = options._prompt;
                if (sub === "setup") await setupTelegramBot();
                else await startTelegramBot();
                break;
            }

            // --- Memory ---
            case "memory":
                await handleMemory(options);
                break;
            case "memories":
                printMemories();
                break;

            // --- Evolutionary ---
            case "fitness":
                console.log(getFitnessSummary());
                break;
            case "strategies":
                console.log(getStrategiesSummary());
                break;
            case "drift":
                console.log(getDriftSummary());
                break;
            case "policy":
                console.log(getPolicyDisplay());
                break;
            case "snapshot": {
                const snapshot = createSnapshot("manual");
                console.log(`\nSnapshot created: ${snapshot.id}`);
                console.log(`   Fitness: ${snapshot.summary.overall_fitness.toFixed(1)}`);
                console.log(`   Generation: ${snapshot.summary.generation}`);
                console.log(`   Phase: ${snapshot.summary.current_phase}`);
                break;
            }
            case "snapshots":
                console.log(getSnapshotsSummary());
                break;
            case "restore": {
                const id = options.id;
                if (!id) {
                    console.error("Error: --id is required");
                    console.log("Usage: npm run dev -- restore --id <snapshot_id>");
                    const snaps = listSnapshots();
                    if (snaps.length > 0) {
                        console.log("\nAvailable snapshots:");
                        for (const s of snaps.slice(-5)) {
                            console.log(`  ${s.id}`);
                        }
                    }
                    process.exit(1);
                }
                const success = restoreFromSnapshot(id);
                if (success) console.log("\nState restored successfully");
                else { console.error("Failed to restore"); process.exit(1); }
                break;
            }

            // --- Adapters ---
            case "adapters":
                printAdaptersStatus();
                break;

            // --- Eval harness ---
            case "eval":
                await handleEval(options);
                break;

            // --- Eval shortcuts (kept for convenience) ---
            case "presets":
                console.log("\nAvailable presets:\n");
                for (const name of listPresets()) {
                    console.log(`  ${name.toLowerCase().replace(/_/g, "-")}`);
                }
                console.log();
                break;


            // --- Help ---
            case "help":
            case "--help":
            case "-h":
            default:
                printUsage();
                break;
        }
    } catch (error: any) {
        console.error("\nError:", error.message);
        if (process.env.DEBUG) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
