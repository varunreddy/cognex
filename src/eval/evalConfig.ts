/**
 * Evaluation Configuration — Feature flags for ablation experiments.
 *
 * Singleton pattern: import { getEvalConfig } from "./evalConfig"
 * In production the master switch (enabled) is false so every guard is a no-op.
 */

export interface EvalConfig {
    enabled: boolean;              // Master switch (false = normal operation)
    label: string;                 // Run label for output files

    // Memory system
    disableTemporalMemory: boolean;
    disableShortTermContext: boolean;
    disableArousal: boolean;
    disableSpreadingActivation: boolean;
    disableConsolidation: boolean;
    disableReflection: boolean;

    // Motivation
    disableDrives: boolean;
    disableHypotheses: boolean;

    // Evolution
    disableStrategies: boolean;
    disablePolicyMutation: boolean;

    // Loop control
    disableStagnationDetection: boolean;

    // API
    useMockApi: boolean;
}

// ---------------------------------------------------------------------------
// Default: everything ON, eval OFF
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG: EvalConfig = {
    enabled: false,
    label: "default",
    disableTemporalMemory: false,
    disableShortTermContext: false,
    disableArousal: false,
    disableSpreadingActivation: false,
    disableConsolidation: false,
    disableReflection: false,
    disableDrives: false,
    disableHypotheses: false,
    disableStrategies: false,
    disablePolicyMutation: false,
    disableStagnationDetection: false,
    useMockApi: false,
};

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------
let currentConfig: EvalConfig = { ...DEFAULT_CONFIG };

export function getEvalConfig(): EvalConfig {
    return currentConfig;
}

export function setEvalConfig(config: EvalConfig): void {
    currentConfig = { ...config };
}

export function resetEvalConfig(): void {
    currentConfig = { ...DEFAULT_CONFIG };
}

/** Convenience: check if a specific flag is active (master switch AND flag) */
export function isDisabled(flag: keyof Omit<EvalConfig, "enabled" | "label" | "useMockApi">): boolean {
    return currentConfig.enabled && currentConfig[flag];
}

// ---------------------------------------------------------------------------
// Named presets
// ---------------------------------------------------------------------------
function preset(label: string, overrides: Partial<EvalConfig>): EvalConfig {
    return { ...DEFAULT_CONFIG, enabled: true, label, ...overrides };
}

export const FULL_SYSTEM = preset("full", {});

export const NO_MEMORY = preset("no-memory", {
    disableTemporalMemory: true,
});

export const NO_AROUSAL = preset("no-arousal", {
    disableArousal: true,
});

export const NO_SPREADING = preset("no-spreading", {
    disableSpreadingActivation: true,
});

export const NO_STM = preset("no-stm", {
    disableShortTermContext: true,
});

export const NO_DRIVES = preset("no-drives", {
    disableDrives: true,
});

export const NO_HYPOTHESES = preset("no-hypotheses", {
    disableHypotheses: true,
});

export const NO_STAGNATION = preset("no-stagnation", {
    disableStagnationDetection: true,
});

export const NO_EVOLUTION = preset("no-evolution", {
    disableStrategies: true,
    disablePolicyMutation: true,
});

export const BASELINE = preset("baseline", {
    disableTemporalMemory: true,
    disableShortTermContext: true,
    disableArousal: true,
    disableSpreadingActivation: true,
    disableConsolidation: true,
    disableReflection: true,
    disableDrives: true,
    disableHypotheses: true,
    disableStrategies: true,
    disablePolicyMutation: true,
    disableStagnationDetection: true,
});

/** Look up a preset by name (case-insensitive). Returns undefined if unknown. */
export function getPreset(name: string): EvalConfig | undefined {
    const presets: Record<string, EvalConfig> = {
        full_system: FULL_SYSTEM,
        full: FULL_SYSTEM,
        no_memory: NO_MEMORY,
        no_arousal: NO_AROUSAL,
        no_spreading: NO_SPREADING,
        no_stm: NO_STM,
        no_drives: NO_DRIVES,
        no_hypotheses: NO_HYPOTHESES,
        no_stagnation: NO_STAGNATION,
        no_evolution: NO_EVOLUTION,
        baseline: BASELINE,
    };
    return presets[name.toLowerCase().replace(/-/g, "_")];
}

/** List all available preset names */
export function listPresets(): string[] {
    return [
        "FULL_SYSTEM", "NO_MEMORY", "NO_STM", "NO_AROUSAL", "NO_SPREADING",
        "NO_DRIVES", "NO_HYPOTHESES", "NO_STAGNATION", "NO_EVOLUTION", "BASELINE",
    ];
}
