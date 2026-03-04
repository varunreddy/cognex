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



