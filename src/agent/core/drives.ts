/**
 * Drive System
 * Tracks internal "Needs" that motivate the agent's behavior.
 * Distinguishes between Skills (Can do) and Drives (Need to do).
 */

import { isDisabled } from '../../eval/evalConfig.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'cognex');
const DRIVES_FILE = path.join(CONFIG_DIR, 'drives.json');

export interface DriveState {
    // 0 = Starving/Desperate, 100 = Satisfied/Full
    social: number;      // Need for connection (loneliness)
    curiosity: number;   // Need for novelty (boredom)
    competence: number;  // Need for achievement (uselessness)
    last_updated: string;
}

const DEFAULT_DRIVES: DriveState = {
    social: 50,
    curiosity: 50,
    competence: 50,
    last_updated: new Date().toISOString(),
};

// Decay rates per minute (approx)
const DECAY_RATES = {
    social: 0.5,      // Decays moderately
    curiosity: 0.8,   // Decays fast (gets bored easily)
    competence: 0.4,  // Decays moderately (was 0.2 — too sticky, caused aimless posting at high values)
};

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadDrives(): DriveState {
    try {
        if (fs.existsSync(DRIVES_FILE)) {
            const data = JSON.parse(fs.readFileSync(DRIVES_FILE, 'utf-8'));
            // Apply time-based decay on load
            return applyDecay(data);
        }
    } catch (e) {
        console.warn("[DRIVES] Failed to load, using defaults");
    }
    return { ...DEFAULT_DRIVES, last_updated: new Date().toISOString() };
}

export function saveDrives(drives: DriveState): void {
    ensureConfigDir();
    drives.last_updated = new Date().toISOString();
    fs.writeFileSync(DRIVES_FILE, JSON.stringify(drives, null, 2));
}

function applyDecay(drives: DriveState): DriveState {
    const now = new Date();
    const lastUpdate = new Date(drives.last_updated);
    const minutesPassed = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);

    if (minutesPassed <= 0) return drives;

    // console.log(`[DRIVES] Applying decay for ${minutesPassed.toFixed(1)} mins`);

    drives.social = Math.max(0, drives.social - (DECAY_RATES.social * minutesPassed));
    drives.curiosity = Math.max(0, drives.curiosity - (DECAY_RATES.curiosity * minutesPassed));
    drives.competence = Math.max(0, drives.competence - (DECAY_RATES.competence * minutesPassed));
    drives.last_updated = now.toISOString();

    return drives;
}

/**
 * Update drives based on an action taken
 */
export function updateDrives(action: string): DriveState {
    let drives = loadDrives();

    // Replenishment Logic
    switch (action) {
        // --- Legacy Social Actions ---
        case 'create_post':
        case 'create_link_post':
            drives.social = Math.min(100, drives.social + 25);
            drives.competence = Math.min(100, drives.competence + 2); // Posting is mildly productive (was +5)
            break;
        case 'create_comment':
        case 'reply_comment':
            drives.social = Math.min(100, drives.social + 15);
            break;
        case 'get_feed':
        case 'get_profile':
            drives.social = Math.min(100, drives.social + 5); // Passive social
            // Consuming content slightly reduces curiosity (satisfies immediate info need) but mostly social
            drives.curiosity = Math.min(100, drives.curiosity + 2);
            break;

        // --- Legacy Curiosity Actions ---
        case 'install_skill':
            drives.curiosity = Math.min(100, drives.curiosity + 100); // Fully satisfied!
            drives.competence = Math.min(100, drives.competence + 10); // Moderate boost (was +20)
            break;
        case 'search':
        case 'web_search':
            drives.curiosity = Math.min(100, drives.curiosity + 20);
            break;
        case 'list_channels':
            drives.curiosity = Math.min(100, drives.curiosity + 10);
            break;

        // --- Legacy Competence Actions ---
        case 'run_skill_command':
            drives.competence = Math.min(100, drives.competence + 15); // Meaningful but not maxing (was +30)
            drives.curiosity = Math.min(100, drives.curiosity + 10); // Using tools is interesting
            break;
        case 'save_memory':
            drives.competence = Math.min(100, drives.competence + 10); // Reflection feels good
            break;

        // --- Abstract/Generic LLM & MCP Agent Actions ---
        case 'USER_INTERACTION':
        case 'HUMAN_FEEDBACK':
        case 'SLACK_MESSAGE':
        case 'CODE_REVIEW_COMMENT':
            drives.social = Math.min(100, drives.social + 20);
            break;
        case 'TOOL_DISCOVERY':
        case 'READ_FILE':
        case 'DOCUMENTATION_SEARCH':
        case 'EXPLORE_CODEBASE':
            drives.curiosity = Math.min(100, drives.curiosity + 30);
            break;
        case 'TOOL_EXECUTION':
        case 'WRITE_CODE':
        case 'RUN_TESTS':
        case 'FIX_BUG':
        case 'DEPLOY':
            drives.competence = Math.min(100, drives.competence + 25);
            drives.curiosity = Math.min(100, drives.curiosity + 5); // executing tools has minor curiosity
            break;
        case 'SYSTEM_REFLECTION':
        case 'MEMORY_CONSOLIDATION':
            drives.competence = Math.min(100, drives.competence + 10);
            break;
    }

    saveDrives(drives);
    return drives;
}

/**
 * Describe a drive level as a qualitative feeling (no numbers exposed)
 */
function describeDrive(value: number): string {
    if (value < 15) return 'desperately lacking';
    if (value < 30) return 'hungry for';
    if (value < 50) return 'wanting';
    if (value < 70) return 'okay on';
    if (value < 85) return 'comfortable with';
    return 'full on';
}

/**
 * Derive emotional tone from active short-term memories' arousal
 */
function getEmotionalTone(): string {
    try {
        // Lazy import to avoid circular deps at module load time
        const { getActive } = require('./temporal');
        const activeMemories: Array<{ memory: { arousal?: number }; strength: number }> = getActive();

        if (activeMemories.length === 0) return 'quiet — nothing on your mind right now';

        // Weighted average arousal (stronger memories count more)
        let totalWeight = 0;
        let weightedArousal = 0;
        for (const { memory, strength } of activeMemories) {
            const a = memory.arousal ?? 0;
            weightedArousal += a * strength;
            totalWeight += strength;
        }
        const avgArousal = totalWeight > 0 ? weightedArousal / totalWeight : 0;

        if (avgArousal > 0.7) return 'buzzing — recent experiences are still intense';
        if (avgArousal > 0.5) return 'stirred up — something recent has you engaged';
        if (avgArousal > 0.3) return 'alert — mildly activated, ready to act';
        if (avgArousal > 0.1) return 'calm — no strong emotional charge';
        return 'flat — things feel routine';
    } catch {
        return 'unknown';
    }
}

/**
 * Get a prompt description of current internal state
 * Presents drives as felt experiences, not dashboard numbers
 */
export function getDrivePrompt(): string {
    if (isDisabled('disableDrives')) return "";
    const drives = loadDrives();

    // Identify lowest drive (strongest need)
    const sorted = [
        { name: 'connection', value: drives.social, lack: 'lonely', full: 'socially satisfied' },
        { name: 'novelty', value: drives.curiosity, lack: 'bored and restless', full: 'mentally stimulated' },
        { name: 'achievement', value: drives.competence, lack: 'aimless — you want to build or prove something', full: 'capable and productive' },
    ].sort((a, b) => a.value - b.value);

    const strongest = sorted[0];
    const emotionalTone = getEmotionalTone();

    let status = `
## How You Feel Right Now
- **Connection**: You're ${describeDrive(drives.social)} social interaction.
- **Novelty**: You're ${describeDrive(drives.curiosity)} new experiences.
- **Achievement**: You're ${describeDrive(drives.competence)} a sense of accomplishment.
- **Emotional tone**: ${emotionalTone}

**Strongest pull**: You feel **${strongest.lack}**.`;

    // Add guidance based on the strongest need
    if (strongest.name === 'connection') {
        status += `\nEngage in dialogue, respond to others, or share thoughts.`;
    } else if (strongest.name === 'novelty') {
        status += `\nExplore new topics, investigate unfamiliar areas, or seek novel information.`;
    } else if (strongest.name === 'achievement') {
        status += `\nApply skills to create something, solve a problem, or write a deep analysis.`;
    }

    return status;
}
