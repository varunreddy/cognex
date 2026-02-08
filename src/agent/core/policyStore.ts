/**
 * Procedural Memory: Policy Store
 * Stores learned behavioral rules (policies) that guide the agent's actions.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'temporal-agent');
const POLICY_FILE = path.join(CONFIG_DIR, 'policies.json');

export interface Policy {
    id: string;
    trigger: string; // e.g., "When creating a post"
    rule: string;    // e.g., "Always add a question to encourage engagement"
    source_insight: string;
    created_at: string;
    confidence: number;
    active: boolean;
    expires_at?: string; // Probation expiry
}

interface PolicyStore {
    policies: Policy[];
}

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadPolicies(): Policy[] {
    try {
        ensureConfigDir();
        if (!fs.existsSync(POLICY_FILE)) {
            return [];
        }
        const data = fs.readFileSync(POLICY_FILE, 'utf-8');
        const store: PolicyStore = JSON.parse(data);
        return store.policies || [];
    } catch (error) {
        console.warn("[POLICY] Failed to load policies:", error);
        return [];
    }
}

export function savePolicy(policy: Omit<Policy, 'id' | 'created_at' | 'active'>): void {
    const policies = loadPolicies();

    // Check for duplicates (simple string match on rule)
    if (policies.some(p => p.rule === policy.rule)) {
        console.log(`[POLICY] Duplicate policy ignored: "${policy.rule}"`);
        return;
    }

    // PROBATION LOGIC:
    // If confidence < 0.95, set expiry to 24 hours
    const isProbation = policy.confidence < 0.95;
    const expiresAt = isProbation
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : undefined;

    const newPolicy: Policy = {
        id: Math.random().toString(36).substring(7),
        created_at: new Date().toISOString(),
        active: true,
        expires_at: expiresAt,
        ...policy
    };

    policies.push(newPolicy);

    try {
        ensureConfigDir();
        fs.writeFileSync(POLICY_FILE, JSON.stringify({ policies }, null, 2));
        console.log(`[POLICY] Saved new policy (Probation: ${isProbation}): "${newPolicy.rule}"`);
    } catch (error) {
        console.error("[POLICY] Failed to save policy:", error);
    }
}

export function getActivePolicies(): Policy[] {
    const now = new Date();
    return loadPolicies().filter(p => {
        if (!p.active) return false;
        // Filter expired probation policies
        if (p.expires_at && new Date(p.expires_at) < now) return false;
        return true;
    });
}

export function formatPoliciesForPrompt(): string {
    const policies = getActivePolicies();
    if (policies.length === 0) return "";

    return policies.map(p => {
        const probationTag = p.expires_at ? " [PROBATION]" : "";
        return `- **Rule**: ${p.rule} (Context: ${p.trigger})${probationTag}`;
    }).join('\n');
}
