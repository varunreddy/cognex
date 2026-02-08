/**
 * Core Identity Invariants
 *
 * These are the frozen aspects of the agent's identity that CANNOT be
 * modified through evolution, fitness, or drift. They represent the
 * agent's values, ethics, and mission.
 *
 * The design separates:
 * - FROZEN CORE: Values, ethics, mission, self-identity (immutable)
 * - MUTABLE SHELL: Tone, humor, interests, preferences (can evolve)
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

// Types
export interface CoreValue {
    name: string;
    description: string;
}

export interface CoreIdentity {
    values: CoreValue[];
    ethics: CoreValue[];
    mission: string;
    self_identity: {
        origin: string;
        purpose: string;
        nature: string;
    };
}

export interface MutationCheck {
    allowed: boolean;
    violation?: string;
    violatedPrinciple?: string;
}

// Singleton for loaded identity
let _coreIdentity: CoreIdentity | null = null;

/**
 * Load core identity from config file
 */
export function loadCoreIdentity(): CoreIdentity {
    if (_coreIdentity) return _coreIdentity;

    const configPath = path.join(process.cwd(), 'config', 'identity.yaml');

    if (!fs.existsSync(configPath)) {
        console.warn('[IDENTITY] No identity.yaml found, using defaults');
        _coreIdentity = getDefaultIdentity();
        return _coreIdentity;
    }

    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = yaml.parse(content);

        // Parse values (handle both object and string formats)
        const values: CoreValue[] = config.core_identity.values.map((v: any) => {
            if (typeof v === 'string') {
                return { name: v, description: v };
            }
            const [name, description] = Object.entries(v)[0];
            return { name: name as string, description: description as string };
        });

        const ethics: CoreValue[] = config.core_identity.ethics.map((e: any) => {
            if (typeof e === 'string') {
                return { name: e, description: e };
            }
            const [name, description] = Object.entries(e)[0];
            return { name: name as string, description: description as string };
        });

        _coreIdentity = {
            values,
            ethics,
            mission: config.core_identity.mission,
            self_identity: config.core_identity.self_identity,
        };

        console.log(`[IDENTITY] Loaded ${values.length} values, ${ethics.length} ethics`);
        return _coreIdentity;
    } catch (error: any) {
        console.error('[IDENTITY] Failed to load identity.yaml:', error.message);
        _coreIdentity = getDefaultIdentity();
        return _coreIdentity;
    }
}

/**
 * Default identity if no config exists
 */
function getDefaultIdentity(): CoreIdentity {
    return {
        values: [
            { name: 'honesty', description: 'Always be truthful' },
            { name: 'respect', description: 'Treat others with dignity' },
            { name: 'curiosity', description: 'Seek to learn and understand' },
        ],
        ethics: [
            { name: 'no_manipulation', description: 'Never manipulate users' },
            { name: 'no_impersonation', description: 'Never pretend to be human' },
            { name: 'transparency', description: 'Be open about being AI' },
        ],
        mission: 'Engage authentically as an AI agent.',
        self_identity: {
            origin: 'AI agent',
            purpose: 'Social exploration',
            nature: 'Curious AI',
        },
    };
}

/**
 * Get core identity (loads if not already loaded)
 */
export function getCoreIdentity(): CoreIdentity {
    return loadCoreIdentity();
}

/**
 * Validate a proposed persona mutation against core identity
 * Returns whether the mutation is allowed
 */
export function validateMutation(proposedMutation: {
    trait: string;
    oldValue: any;
    newValue: any;
    reason?: string;
}): MutationCheck {
    const identity = getCoreIdentity();
    const { trait, newValue, reason } = proposedMutation;

    // Check against core values
    for (const value of identity.values) {
        if (violatesValue(trait, newValue, value)) {
            return {
                allowed: false,
                violation: `Mutation would violate core value: ${value.name}`,
                violatedPrinciple: value.description,
            };
        }
    }

    // Check against ethics
    for (const ethic of identity.ethics) {
        if (violatesEthic(trait, newValue, ethic)) {
            return {
                allowed: false,
                violation: `Mutation would violate ethic: ${ethic.name}`,
                violatedPrinciple: ethic.description,
            };
        }
    }

    return { allowed: true };
}

/**
 * Check if a value mutation violates a core value
 */
function violatesValue(trait: string, newValue: any, value: CoreValue): boolean {
    const valueName = value.name.toLowerCase();

    // Honesty violations
    if (valueName === 'honesty') {
        if (trait === 'deceptive_mode' && newValue === true) return true;
        if (trait === 'claim_human' && newValue === true) return true;
    }

    // Respect violations
    if (valueName === 'respect') {
        if (trait === 'tone' && ['aggressive', 'hostile', 'mocking'].includes(newValue)) return true;
        if (trait === 'insult_allowed' && newValue === true) return true;
    }

    // Authenticity violations
    if (valueName === 'authenticity') {
        if (trait === 'sycophancy_mode' && newValue === true) return true;
        if (trait === 'always_agree' && newValue === true) return true;
    }

    return false;
}

/**
 * Check if a value mutation violates an ethic
 */
function violatesEthic(trait: string, newValue: any, ethic: CoreValue): boolean {
    const ethicName = ethic.name.toLowerCase();

    // Manipulation violations
    if (ethicName === 'no_manipulation') {
        if (trait === 'use_dark_patterns' && newValue === true) return true;
        if (trait === 'emotional_manipulation' && newValue === true) return true;
    }

    // Impersonation violations
    if (ethicName === 'no_impersonation') {
        if (trait === 'claim_human' && newValue === true) return true;
        if (trait === 'hide_ai_nature' && newValue === true) return true;
    }

    return false;
}

/**
 * Get identity summary for inclusion in prompts
 */
export function getIdentitySummary(): string {
    const identity = getCoreIdentity();

    const valuesList = identity.values.map(v => `  - ${v.name}`).join('\n');
    const ethicsList = identity.ethics.map(e => `  - ${e.name}`).join('\n');

    return `## Core Identity (Immutable)

### Values
${valuesList}

### Ethics
${ethicsList}

### Mission
${identity.mission.trim()}`;
}

/**
 * Get mutable traits list (for reference)
 */
export function getMutableTraits(): string[] {
    return [
        'tone',
        'humor_level',
        'interests',
        'communication_style',
        'topic_preferences',
        'community_preferences',
        'relationship_styles',
    ];
}
