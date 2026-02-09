/**
 * Eval config - controls which features are on/off during evaluation runs.
 * 
 * simplified this down to just two presets since behavioral evaluation
 * showed that STM on/off is what really matters:
 *   - full: everything on, memory persists across actions
 *   - no-stm: short-term memory off, each cycle starts fresh
 * 
 * Combine with --profile baseline|scoped to control whether the agent
 * gets focused tasks or can do whatever it wants.
 */

export interface EvalConfig {
    enabled: boolean;              // flip this on to activate eval mode
    label: string;                 // shows up in output filenames

    // these control what parts of the memory system are active
    disableTemporalMemory: boolean;
    disableShortTermContext: boolean;
    disableArousal: boolean;
    disableSpreadingActivation: boolean;
    disableConsolidation: boolean;
    disableReflection: boolean;

    // motivation stuff
    disableDrives: boolean;
    disableHypotheses: boolean;

    // evolutionary behavior
    disableStrategies: boolean;
    disablePolicyMutation: boolean;

    // prevents the agent from detecting when it's stuck
    disableStagnationDetection: boolean;

    // if you want to tweak how many things fit in short-term memory
    stmSize?: number;

    // use fake API responses instead of hitting the real service
    useMockApi: boolean;
}

// everything enabled by default, eval mode off
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
    disableHypotheses: true,   // disabled: Moltbook bot environment provides no meaningful signal
    disableStrategies: false,
    disablePolicyMutation: false,
    disableStagnationDetection: false,
    useMockApi: false,
};

// we store the active config here so any module can check it
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

/**
 * Quick way to check if a feature is turned off.
 * Only returns true if we're in eval mode AND the specific flag is set.
 */
export function isDisabled(flag: keyof Omit<EvalConfig, "enabled" | "label" | "useMockApi" | "stmSize">): boolean {
    return currentConfig.enabled && currentConfig[flag];
}

// helper to create a preset with sensible defaults
function preset(label: string, overrides: Partial<EvalConfig>): EvalConfig {
    return { ...DEFAULT_CONFIG, enabled: true, label, ...overrides };
}

/*
 * The two presets we actually care about:
 * 
 * FULL_SYSTEM - agent has all its memory, good for seeing long-term behavior
 * NO_STM - no short-term context, so each action is basically independent
 */

/** everything on - use this to see how the agent behaves with full memory */
export const FULL_SYSTEM = preset("full", {});

/** short-term memory disabled - agent won't remember what it just did */
export const NO_STM = preset("no-stm", {
    disableShortTermContext: true,
});

/** get a preset by name, handles various formats like "no-stm" or "NO_STM" */
export function getPreset(name: string): EvalConfig | undefined {
    const presets: Record<string, EvalConfig> = {
        full_system: FULL_SYSTEM,
        full: FULL_SYSTEM,
        no_stm: NO_STM,
    };
    return presets[name.toLowerCase().replace(/-/g, "_")];
}

/** returns the names you can use with --preset */
export function listPresets(): string[] {
    return ["FULL", "NO_STM"];
}
