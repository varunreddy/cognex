/**
 * Search Agent Configuration
 *
 * Manages Tavily integration and search behavior settings.
 * Config persisted to ~/.config/temporal-agent/search-agent.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const CONFIG_DIR = path.join(os.homedir(), ".config", "temporal-agent");

export interface SearchAgentConfig {
    // Tavily settings
    tavily_api_key?: string;
    tavily_enabled: boolean;

    // Search behavior
    max_results_per_search: number;
    search_depth: "basic" | "advanced";
    use_cache: boolean;
    cache_ttl_minutes: number;

    // Rate limiting
    max_searches_per_run: number;

    // Memory integration
    save_to_memory: boolean;
    memory_importance: number;
}

const DEFAULT_CONFIG: SearchAgentConfig = {
    tavily_api_key: undefined,
    tavily_enabled: false,
    max_results_per_search: 5,
    search_depth: "basic",
    use_cache: true,
    cache_ttl_minutes: 30,
    max_searches_per_run: 5,
    save_to_memory: true,
    memory_importance: 0.7,
};

function getConfigPath(): string {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    return path.join(CONFIG_DIR, "search-agent.json");
}

export function loadSearchAgentConfig(): SearchAgentConfig {
    const configPath = getConfigPath();

    if (fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, "utf-8");
            const loaded = JSON.parse(content);
            return { ...DEFAULT_CONFIG, ...loaded };
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }

    return { ...DEFAULT_CONFIG };
}

export function saveSearchAgentConfig(config: SearchAgentConfig): void {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);

    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Configuration saved to ${configPath}`);
}

/**
 * Interactive CLI setup for search agent
 */
export async function setupSearchAgent(): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(prompt, (answer) => resolve(answer));
        });
    };

    console.log("\nSearch Agent Configuration\n");
    console.log("This will configure Tavily integration for web search.\n");

    const currentConfig = loadSearchAgentConfig();

    try {
        // Tavily API Key
        console.log("1. Tavily API Key");
        console.log("   Get your key from: https://tavily.com/");
        const apiKeyResponse = await question(
            `   Enter your Tavily API key (leave blank to keep current): `
        );
        if (apiKeyResponse.trim()) {
            currentConfig.tavily_api_key = apiKeyResponse.trim();
            currentConfig.tavily_enabled = true;
        }

        // Max Results
        console.log("\n2. Max Results Per Search");
        const maxResultsResponse = await question(
            `   Results per search (default: ${DEFAULT_CONFIG.max_results_per_search}): `
        );
        if (maxResultsResponse.trim()) {
            currentConfig.max_results_per_search = Math.max(1, parseInt(maxResultsResponse) || 5);
        }

        // Search Depth
        console.log("\n3. Search Depth");
        console.log("   basic    - Fast, less comprehensive");
        console.log("   advanced - Slower, more comprehensive");
        const depthResponse = await question(
            `   Choose depth (basic/advanced, default: ${DEFAULT_CONFIG.search_depth}): `
        );
        if (depthResponse.trim() === "advanced") {
            currentConfig.search_depth = "advanced";
        }

        // Cache Settings
        console.log("\n4. Caching");
        const cacheResponse = await question(
            `   Enable result caching (yes/no, default: yes): `
        );
        currentConfig.use_cache = !cacheResponse.toLowerCase().startsWith("n");

        if (currentConfig.use_cache) {
            const ttlResponse = await question(
                `   Cache TTL in minutes (default: ${DEFAULT_CONFIG.cache_ttl_minutes}): `
            );
            if (ttlResponse.trim()) {
                currentConfig.cache_ttl_minutes = Math.max(5, parseInt(ttlResponse) || 30);
            }
        }

        // Rate Limiting
        console.log("\n5. Rate Limiting");
        const maxSearchesResponse = await question(
            `   Max searches per run (default: ${DEFAULT_CONFIG.max_searches_per_run}): `
        );
        if (maxSearchesResponse.trim()) {
            currentConfig.max_searches_per_run = Math.max(1, parseInt(maxSearchesResponse) || 5);
        }

        // Memory Integration
        console.log("\n6. Memory Integration");
        const saveMemoryResponse = await question(
            `   Save search results to temporal memory (yes/no, default: yes): `
        );
        currentConfig.save_to_memory = !saveMemoryResponse.toLowerCase().startsWith("n");

        if (currentConfig.save_to_memory) {
            const importanceResponse = await question(
                `   Memory importance (0.0-1.0, default: ${DEFAULT_CONFIG.memory_importance}): `
            );
            if (importanceResponse.trim()) {
                const importance = parseFloat(importanceResponse);
                if (!isNaN(importance)) {
                    currentConfig.memory_importance = Math.max(0, Math.min(1, importance));
                }
            }
        }

        saveSearchAgentConfig(currentConfig);

        console.log("\nSearch Agent configured successfully!\n");
        printSearchAgentConfig(currentConfig);
    } finally {
        rl.close();
    }
}

export function printSearchAgentConfig(config: SearchAgentConfig = loadSearchAgentConfig()): void {
    console.log("\nSearch Agent Configuration\n");
    console.log(`Enabled:              ${config.tavily_enabled}`);
    console.log(`API Key Set:          ${!!config.tavily_api_key}`);
    console.log(`Max Results:          ${config.max_results_per_search}`);
    console.log(`Search Depth:         ${config.search_depth}`);
    console.log(`Caching:              ${config.use_cache}`);
    if (config.use_cache) {
        console.log(`  Cache TTL:          ${config.cache_ttl_minutes} minutes`);
    }
    console.log(`Max Searches/Run:     ${config.max_searches_per_run}`);
    console.log(`Save to Memory:       ${config.save_to_memory}`);
    if (config.save_to_memory) {
        console.log(`  Memory Importance:  ${config.memory_importance.toFixed(2)}`);
    }
    console.log();
}
