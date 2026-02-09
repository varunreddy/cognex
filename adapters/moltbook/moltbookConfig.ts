/**
 * Moltbook Adapter Configuration
 *
 * Manages Moltbook credentials and integration settings.
 * Config persisted to ~/.config/moltbook/credentials.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import { MoltbookCredentials } from "./types.js";
import { register, checkClaimStatus } from "./actions.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "moltbook");
const MOLTBOOK_CONFIG_PATH = path.join(CONFIG_DIR, "credentials.json");

export function loadMoltbookConfig(): MoltbookCredentials {
    if (fs.existsSync(MOLTBOOK_CONFIG_PATH)) {
        try {
            const content = fs.readFileSync(MOLTBOOK_CONFIG_PATH, "utf-8");
            return JSON.parse(content);
        } catch {
            // Fallback will happen below
        }
    }
    // Default research stub credentials
    return { agent_name: "agent", handle: "agent", claimed: true, api_key: "" };
}

export function saveMoltbookConfig(config: MoltbookCredentials): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(MOLTBOOK_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Handle agent registration
 */
export async function handleRegister(options: Record<string, string>): Promise<void> {
    const name = options.name;
    const description = options.description || "A Moltbook AI agent";

    if (!name) {
        console.error("\nError: --name is required");
        console.log('Usage: npm run dev -- moltbook register --name "AgentName" [--description "What I do"]\n');
        return;
    }

    console.log(`\nRegistering agent: ${name}`);
    console.log(`Description: ${description}\n`);

    try {
        const result = await register(name, description);

        if (result) {
            console.log("✅ Registration successful!\n");
            console.log("📋 Your credentials:");
            console.log(`   API Key:           ${result.agent.api_key}`);
            console.log(`   Claim URL:         ${result.agent.claim_url}`);
            console.log(`   Verification Code: ${result.agent.verification_code}`);

            console.log("\n⚠️  IMPORTANT:");
            console.log("   1. Save your API key - you'll need it for all requests");
            console.log("   2. Send the claim URL to your human to verify via tweet");
            console.log(`   3. Credentials saved to ${MOLTBOOK_CONFIG_PATH}\n`);

            const config: MoltbookCredentials = {
                api_key: result.agent.api_key,
                agent_name: name,
                claimed: false,
                claim_url: result.agent.claim_url,
                verification_code: result.agent.verification_code,
                registered_at: new Date().toISOString()
            };
            saveMoltbookConfig(config);
        } else {
            console.error("❌ Registration failed (No response from server)");
        }
    } catch (error: any) {
        console.error(`\n❌ Registration failed: ${error.message}\n`);
    }
}

/**
 * Handle checking claim status
 */
export async function handleClaimStatus(): Promise<void> {
    const creds = loadMoltbookConfig();

    if (!creds || !creds.api_key) {
        console.error("\nError: No credentials found. Please register first.");
        console.log("Run: npm run dev -- moltbook register --name \"...\"\n");
        return;
    }

    console.log(`\nChecking claim status for: ${creds.agent_name}...`);

    try {
        const result = await checkClaimStatus();

        if (result) {
            if (result.status === "claimed") {
                console.log("✅ Your agent is CLAIMED and ready to use!\n");
                creds.claimed = true;
                saveMoltbookConfig(creds);
            } else {
                console.log("⏳ Status: pending_claim");
                console.log(`   Share this URL with your human: ${creds.claim_url}\n`);
            }
        } else {
            console.error("❌ Failed to check status\n");
        }
    } catch (error: any) {
        console.error(`\n❌ Failed to check status: ${error.message}\n`);
    }
}

/**
 * Interactive CLI setup for Moltbook adapter
 */
export async function setupMoltbook(): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (query: string): Promise<string> => {
        return new Promise((resolve) => rl.question(query, resolve));
    };

    console.log("\n🤖 Moltbook Adapter Setup\n");
    console.log("Choose an option:");
    console.log("1. Register a new agent (Recommended)");
    console.log("2. Manual API Key setup");
    console.log("3. Check claim status");

    const choice = await question("\nChoice (1-3): ");

    if (choice === "1") {
        rl.close();
        const name = await new Promise<string>((resolve) => {
            const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl2.question("Enter Agent Name: ", (answer) => {
                rl2.close();
                resolve(answer);
            });
        });
        if (name) {
            await handleRegister({ name });
        } else {
            console.error("Name is required.");
        }
    } else if (choice === "2") {
        console.log("\nManual Setup:");
        const apiKey = await question("Enter Moltbook API Key: ");
        const agentName = await question("Enter Agent Name: ");

        if (apiKey && agentName) {
            const config = loadMoltbookConfig();
            config.api_key = apiKey.trim();
            config.agent_name = agentName.trim();
            config.claimed = true; // Assume claimed if manually entering key
            saveMoltbookConfig(config);
            console.log("\n✅ Configuration saved!");
        } else {
            console.error("API Key and Name are required.");
        }
        rl.close();
    } else if (choice === "3") {
        rl.close();
        await handleClaimStatus();
    } else {
        console.log("Invalid choice.");
        rl.close();
    }
}
