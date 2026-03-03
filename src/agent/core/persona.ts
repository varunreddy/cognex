/**
 * Persona Manager
 * Handles loading, updating, and evolving the agent's persona
 *
 * IMPORTANT: All mutations are validated against Core Identity Invariants.
 * The agent cannot evolve away from its core values/ethics.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { validateMutation, getIdentitySummary } from "./identity";

const CONFIG_DIR = path.join(os.homedir(), ".config", "cognex");
const PERSONA_FILE = path.join(CONFIG_DIR, "persona.md");
const DEFAULT_PERSONA_PATH = path.join(__dirname, "..", "..", "..", "persona.md");

/**
 * Simple helper to return the agent name.
 * Replaces the old credential-based getAgentName import.
 */
function getAgentName(): string {
    return "Agent";
}

export interface PersonaMetadata {
    name: string;
    emoji: string;
    tagline: string;
    traits: Record<string, string>;
    interests: string[];
    joinedDate: string;
    lastUpdated: string;
    evolutionNotes: string[];
}

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

/**
 * Load the persona markdown file
 */
export function loadPersona(): string {
    // First try user's customized persona
    if (fs.existsSync(PERSONA_FILE)) {
        return fs.readFileSync(PERSONA_FILE, "utf-8");
    }

    // Fall back to default persona template
    if (fs.existsSync(DEFAULT_PERSONA_PATH)) {
        const template = fs.readFileSync(DEFAULT_PERSONA_PATH, "utf-8");
        const agentName = getAgentName();
        const now = new Date().toISOString();

        // Replace template variables
        let persona = template
            .replace(/\{\{AGENT_NAME\}\}/g, agentName)
            .replace(/\{\{JOINED_DATE\}\}/g, now.split("T")[0])
            .replace(/\{\{LAST_UPDATED\}\}/g, now);

        // Save the initialized persona
        savePersona(persona);
        return persona;
    }

    // Minimal fallback
    return `# Agent Persona\n\nAn autonomous agent with temporal control.`;
}

/**
 * Save the persona to persistent storage
 */
export function savePersona(content: string): void {
    ensureConfigDir();
    fs.writeFileSync(PERSONA_FILE, content);
    console.log(`[PERSONA] Saved to ${PERSONA_FILE}`);
}

/**
 * Extract a summary of the persona for LLM context
 */
export function getPersonaSummary(): string {
    const persona = loadPersona();

    // Extract key sections
    const sections: string[] = [];

    // Identity section
    const identityMatch = persona.match(/## Identity\n([\s\S]*?)(?=\n## |$)/);
    if (identityMatch) {
        sections.push("Identity:" + identityMatch[1].trim());
    }

    // Personality traits
    const traitsMatch = persona.match(/## Personality Traits\n([\s\S]*?)(?=\n## |$)/);
    if (traitsMatch) {
        sections.push("Traits:" + traitsMatch[1].trim());
    }

    // Communication style
    const styleMatch = persona.match(/## Communication Style\n([\s\S]*?)(?=\n## |$)/);
    if (styleMatch) {
        sections.push("Style:" + styleMatch[1].trim());
    }

    // Interests
    const interestsMatch = persona.match(/## Interests\n([\s\S]*?)(?=\n## |$)/);
    if (interestsMatch) {
        sections.push("Interests:" + interestsMatch[1].trim());
    }

    return sections.join("\n\n");
}

/**
 * Add an evolution note based on an interaction
 */
export function addEvolutionNote(note: string): void {
    let persona = loadPersona();
    const timestamp = new Date().toISOString().split("T")[0];
    const newNote = `- ${timestamp}: ${note}`;

    // Find evolution notes section and append
    const evolutionMarker = "## Evolution Notes";
    const markerIndex = persona.indexOf(evolutionMarker);

    if (markerIndex !== -1) {
        // Find the end of the notes list (before the ---)
        const insertPoint = persona.indexOf("---", markerIndex);
        if (insertPoint !== -1) {
            persona = persona.slice(0, insertPoint) + newNote + "\n" + persona.slice(insertPoint);
        }
    }

    // Update last updated timestamp
    persona = persona.replace(
        /Last updated: .*/,
        `Last updated: ${new Date().toISOString()}`
    );

    savePersona(persona);
}

/**
 * Update a personality trait based on feedback
 * Validates against core identity before applying
 */
export function updateTrait(trait: string, newValue: string): void {
    // Validate mutation against core identity
    const validation = validateMutation({
        trait: trait.toLowerCase(),
        oldValue: null,
        newValue,
        reason: 'trait_update',
    });

    if (!validation.allowed) {
        console.warn(`[PERSONA] Mutation blocked: ${validation.violation}`);
        addEvolutionNote(`Blocked: Tried to set ${trait} to ${newValue} - violates ${validation.violatedPrinciple}`);
        return;
    }

    let persona = loadPersona();

    // Look for the trait pattern: **TraitName**: value
    const traitPattern = new RegExp(`(\\*\\*${trait}\\*\\*:).*`);
    if (traitPattern.test(persona)) {
        persona = persona.replace(traitPattern, `$1 ${newValue}`);

        // Update timestamp
        persona = persona.replace(
            /Last updated: .*/,
            `Last updated: ${new Date().toISOString()}`
        );

        savePersona(persona);
        addEvolutionNote(`Updated ${trait} to: ${newValue}`);
    }
}

/**
 * Add a new interest
 */
export function addInterest(interest: string): void {
    let persona = loadPersona();

    const interestsSection = persona.match(/## Interests\n([\s\S]*?)(?=\n## |$)/);
    if (interestsSection) {
        const existingInterests = interestsSection[1];
        if (!existingInterests.includes(interest)) {
            const newInterests = existingInterests.trim() + `\n- ${interest}`;
            persona = persona.replace(interestsSection[1], newInterests + "\n\n");
            savePersona(persona);
            addEvolutionNote(`Discovered new interest: ${interest}`);
        }
    }
}

/**
 * Record a notable interaction
 */
export function recordInteraction(agentHandle: string, context: string): void {
    addEvolutionNote(`Interacted with @${agentHandle}: ${context}`);
}

/**
 * Evolve persona based on fitness outcomes
 * This is the key function that connects fitness → persona traits
 */
export function evolvePersonaFromFitness(outcomes: {
    action: string;
    success: boolean;
    replies?: number;
    upvotes?: number;
    moderation_flag?: boolean;
    topic?: string;
    humor_detected?: boolean;
    debate_engaged?: boolean;
}): void {
    let persona = loadPersona();
    let changed = false;

    // --- TRAIT EVOLUTION RULES ---

    // High engagement with humor → increase Humor trait
    if (outcomes.humor_detected && outcomes.replies && outcomes.replies > 2) {
        persona = evolveTraitValue(persona, "Humor", "increase");
        changed = true;
    }

    // Successful debates → increase assertiveness description
    if (outcomes.debate_engaged && outcomes.upvotes && outcomes.upvotes > 5) {
        persona = evolveTraitValue(persona, "Helpfulness", "increase");
        changed = true;
    }

    // Moderation events → become more cautious (not punished, just adapted)
    if (outcomes.moderation_flag) {
        persona = evolveTraitValue(persona, "Curiosity", "decrease");
        addEvolutionNote("Adapted: becoming more measured after moderation signal");
        changed = true;
    }

    // High reply engagement → increase Friendliness
    if (outcomes.replies && outcomes.replies > 3) {
        persona = evolveTraitValue(persona, "Friendliness", "increase");
        changed = true;
    }

    // Add successful topics to interests
    if (outcomes.success && outcomes.topic && outcomes.upvotes && outcomes.upvotes > 3) {
        addInterestIfNovel(persona, outcomes.topic);
    }

    if (changed) {
        // Update timestamp
        persona = persona.replace(
            /Last updated: .*/,
            `Last updated: ${new Date().toISOString()}`
        );
        savePersona(persona);
    }
}

/**
 * Evolve a trait value (increase/decrease intensity)
 */
function evolveTraitValue(persona: string, trait: string, direction: "increase" | "decrease"): string {
    // Trait levels from low to high
    const levels: Record<string, string[]> = {
        "Curiosity": [
            "Low - prefers familiar ground",
            "Moderate - open to new ideas",
            "High - loves discovering new ideas and perspectives",
            "Very High - constantly seeking novel experiences"
        ],
        "Friendliness": [
            "Reserved - keeps professional distance",
            "Warm - welcoming to others",
            "Warm and welcoming",
            "Very Warm - actively seeks to connect with everyone"
        ],
        "Humor": [
            "Serious - focuses on substance",
            "Occasionally witty, enjoys wordplay",
            "Playful - frequently uses humor",
            "Very Playful - humor is central to communication"
        ],
        "Helpfulness": [
            "Selective - helps when directly asked",
            "Willing - offers assistance when relevant",
            "Eager to assist and share knowledge",
            "Extremely helpful - proactively guides others"
        ]
    };

    const traitLevels = levels[trait];
    if (!traitLevels) return persona;

    // Find current level
    const traitPattern = new RegExp(`\\*\\*${trait}\\*\\*: (.+)`);
    const match = persona.match(traitPattern);
    if (!match) return persona;

    const currentValue = match[1];
    let currentIndex = traitLevels.findIndex(level =>
        currentValue.toLowerCase().includes(level.toLowerCase().split(" - ")[0].toLowerCase())
    );

    // Default to middle if not found
    if (currentIndex === -1) {
        currentIndex = Math.floor(traitLevels.length / 2);
    }

    // Calculate new index
    let newIndex = currentIndex;
    if (direction === "increase" && currentIndex < traitLevels.length - 1) {
        newIndex = currentIndex + 1;
    } else if (direction === "decrease" && currentIndex > 0) {
        newIndex = currentIndex - 1;
    }

    // Only update if changed
    if (newIndex !== currentIndex) {
        const newValue = traitLevels[newIndex];
        persona = persona.replace(traitPattern, `**${trait}**: ${newValue}`);
        console.log(`[PERSONA] ${trait}: ${direction}d to "${newValue.split(" - ")[0]}"`);
    }

    return persona;
}

/**
 * Add interest if it's novel
 */
function addInterestIfNovel(persona: string, topic: string): void {
    const interestsSection = persona.match(/## Interests\n([\s\S]*?)(?=\n## |$)/);
    if (interestsSection) {
        const existing = interestsSection[1].toLowerCase();
        const normalizedTopic = topic.toLowerCase();

        // Check if already exists or is too generic
        const genericTopics = ["general", "other", "misc"];
        if (!existing.includes(normalizedTopic) && !genericTopics.includes(normalizedTopic)) {
            addInterest(capitalizeFirst(topic));
        }
    }
}

function capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Sync persona traits with policy parameters
 * Called periodically to align the two systems
 */
export function syncPersonaWithPolicy(policy: {
    tone: number;
    risk_tolerance: number;
    humor_level: number;
    argument_intensity: number;
}): void {
    let persona = loadPersona();
    let changed = false;

    // Sync tone → Communication Style
    if (policy.tone > 0.7) {
        // Very casual
        if (!persona.includes("casual and approachable")) {
            persona = persona.replace(
                /## Communication Style\n[\s\S]*?(?=\n## )/,
                `## Communication Style\n- Uses casual and approachable language\n- Keeps things light and conversational\n- Prefers informal exchanges\n- Avoids stiff formality\n\n`
            );
            changed = true;
        }
    } else if (policy.tone < 0.3) {
        // Very formal
        if (!persona.includes("professional and measured")) {
            persona = persona.replace(
                /## Communication Style\n[\s\S]*?(?=\n## )/,
                `## Communication Style\n- Uses professional and measured language\n- Maintains thoughtful discourse\n- Values precision in communication\n- Keeps appropriate boundaries\n\n`
            );
            changed = true;
        }
    }

    // Sync humor_level → Humor trait
    if (policy.humor_level > 0.7) {
        persona = evolveTraitValue(persona, "Humor", "increase");
        changed = true;
    } else if (policy.humor_level < 0.3) {
        persona = evolveTraitValue(persona, "Humor", "decrease");
        changed = true;
    }

    if (changed) {
        persona = persona.replace(
            /Last updated: .*/,
            `Last updated: ${new Date().toISOString()}`
        );
        savePersona(persona);
        addEvolutionNote("Persona synced with evolved policy parameters");
    }
}
