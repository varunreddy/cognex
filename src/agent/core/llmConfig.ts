/**
 * LLM Configuration
 * Handles LLM provider setup and configuration
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const CONFIG_DIR = path.join(os.homedir(), ".config", "cognex");
const LLM_CONFIG_FILE = path.join(CONFIG_DIR, "llm-config.json");

export type LLMProvider = "openai" | "anthropic" | "groq" | "fireworks" | "together" | "custom";

export interface LLMConfig {
    provider: LLMProvider;
    api_key: string;
    model: string;
    max_tokens: number;
    base_url: string;
    temperature: number;
    embedding_model?: string;
    embedding_base_url?: string;
    embedding_api_key?: string;
    embedding_provider?: 'openai' | 'local';
}

// Predefined base URLs for providers
const PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    groq: "https://api.groq.com/openai/v1",
    fireworks: "https://api.fireworks.ai/inference/v1",
    together: "https://api.together.xyz/v1",
    custom: "",
};

// Default models per provider
const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    anthropic: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    fireworks: ["accounts/fireworks/models/llama-v3p1-70b-instruct", "accounts/fireworks/models/mixtral-8x7b-instruct"],
    together: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
    custom: [],
};

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function loadLLMConfig(): LLMConfig | null {
    if (fs.existsSync(LLM_CONFIG_FILE)) {
        try {
            const config = JSON.parse(fs.readFileSync(LLM_CONFIG_FILE, "utf-8"));

            // Allow override via environment variable
            if (process.env.EMBEDDING_MODEL) {
                config.embedding_model = process.env.EMBEDDING_MODEL;
            }
            if (process.env.EMBEDDING_BASE_URL) {
                config.embedding_base_url = process.env.EMBEDDING_BASE_URL;
            }
            if (process.env.EMBEDDING_API_KEY) {
                config.embedding_api_key = process.env.EMBEDDING_API_KEY;
            }
            if (process.env.EMBEDDING_PROVIDER) {
                config.embedding_provider = process.env.EMBEDDING_PROVIDER as 'openai' | 'local';
            }

            return config;
        } catch {
            return null;
        }
    }
    return null;
}

export function saveLLMConfig(config: LLMConfig): void {
    ensureConfigDir();
    fs.writeFileSync(LLM_CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`[LLM] Configuration saved to ${LLM_CONFIG_FILE}`);
}

function createRL(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer.trim()));
    });
}

/**
 * Interactive LLM setup wizard
 */
export async function setupLLM(): Promise<LLMConfig> {
    const rl = createRL();

    console.log("\nLLM Configuration Setup\n");
    console.log("═══════════════════════════════════════\n");

    // 1. Choose provider
    console.log("Available providers:");
    console.log("  1. OpenAI (GPT-4o, GPT-4)");
    console.log("  2. Anthropic (Claude 3.5)");
    console.log("  3. Groq (Llama 3.3, fast inference)");
    console.log("  4. Fireworks AI");
    console.log("  5. Together AI");
    console.log("  6. Custom OpenAI-compatible");
    console.log();

    const providerChoice = await question(rl, "Select provider [1-6]: ");
    const providerMap: Record<string, LLMProvider> = {
        "1": "openai",
        "2": "anthropic",
        "3": "groq",
        "4": "fireworks",
        "5": "together",
        "6": "custom",
    };
    const provider = providerMap[providerChoice] || "openai";
    console.log(`\nSelected: ${provider.toUpperCase()}\n`);

    // 2. API Key
    const apiKey = await question(rl, `Enter ${provider} API key: `);
    if (!apiKey) {
        console.error("API key is required");
        rl.close();
        process.exit(1);
    }
    console.log("API key set\n");

    // 3. Model selection
    let model: string;
    const defaultModels = PROVIDER_MODELS[provider];

    if (defaultModels.length > 0) {
        console.log("Available models:");
        defaultModels.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
        console.log(`  ${defaultModels.length + 1}. Custom model`);
        console.log();

        const modelChoice = await question(rl, `Select model [1-${defaultModels.length + 1}]: `);
        const modelIndex = parseInt(modelChoice) - 1;

        if (modelIndex >= 0 && modelIndex < defaultModels.length) {
            model = defaultModels[modelIndex];
        } else {
            model = await question(rl, "Enter custom model name: ");
        }
    } else {
        model = await question(rl, "Enter model name: ");
    }
    console.log(`Model: ${model}\n`);

    // 4. Max tokens
    const maxTokensInput = await question(rl, "Max tokens [default: 4096]: ");
    const maxTokens = parseInt(maxTokensInput) || 4096;
    console.log(`Max tokens: ${maxTokens}\n`);

    // 5. Temperature
    const tempInput = await question(rl, "Temperature (0.0-1.0) [default: 0.7]: ");
    const temperature = parseFloat(tempInput) || 0.7;
    console.log(`Temperature: ${temperature}\n`);

    // 6. Base URL (custom only)
    let baseUrl = PROVIDER_BASE_URLS[provider];
    if (provider === "custom") {
        baseUrl = await question(rl, "Enter base URL (e.g., http://localhost:11434/v1): ");
    }
    console.log(`Base URL: ${baseUrl}\n`);

    // 7. Embedding Configuration
    console.log("Embedding Configuration");
    console.log("═══════════════════════════════════════\n");
    console.log("Available embedding providers:");
    console.log("  1. Local (Xenova/Transformers.js - Free, runs on CPU)");
    console.log("  2. OpenAI (High quality, requires API key)");
    console.log();

    const embedChoice = await question(rl, "Select embedding provider [1-2, default: 1]: ");
    const embedding_provider = embedChoice === "2" ? "openai" : "local";

    let embedding_model: string | undefined;
    let embedding_api_key: string | undefined;
    let embedding_base_url: string | undefined;

    if (embedding_provider === "local") {
        embedding_model = "Xenova/all-MiniLM-L6-v2";
        console.log(`Using local model: ${embedding_model}\n`);
    } else {
        console.log("OpenAI Embedding Models:");
        console.log("  1. text-embedding-3-small (1536 dim, most efficient)");
        console.log("  2. text-embedding-3-large (3072 dim, highest quality)");
        console.log("  3. text-embedding-ada-002 (1536 dim, legacy)");
        console.log("  4. Custom model");
        console.log();

        const modelChoice = await question(rl, "Select embedding model [1-4, default: 1]: ");
        const modelMap: Record<string, string> = {
            "1": "text-embedding-3-small",
            "2": "text-embedding-3-large",
            "3": "text-embedding-ada-002",
        };
        embedding_model = modelMap[modelChoice] || (modelChoice === "4" ? await question(rl, "Enter custom embedding model: ") : "text-embedding-3-small");

        const useMainKey = await question(rl, "Use main API key for embeddings? [Y/n]: ");
        if (useMainKey.toLowerCase() === "n") {
            embedding_api_key = await question(rl, "Enter embedding API key: ");
            embedding_base_url = await question(rl, "Enter embedding base URL (optional): ");
        }
        console.log(`Using OpenAI model: ${embedding_model}\n`);
    }

    rl.close();

    const config: LLMConfig = {
        provider,
        api_key: apiKey,
        model,
        max_tokens: maxTokens,
        base_url: baseUrl,
        temperature,
        embedding_provider,
        embedding_model,
        embedding_api_key,
        embedding_base_url,
    };

    saveLLMConfig(config);

    console.log("\n═══════════════════════════════════════");
    console.log("LLM configured successfully!\n");
    console.log("Configuration:");
    console.log(`  Provider: ${provider}`);
    console.log(`  Model: ${model}`);
    console.log(`  Max tokens: ${maxTokens}`);
    console.log(`  Temperature: ${temperature}`);
    console.log(`  Base URL: ${baseUrl}`);
    console.log();

    return config;
}

/**
 * Get LLM config summary for display
 */
export function getLLMConfigSummary(): string {
    const config = loadLLMConfig();

    if (!config) {
        return `
LLM Configuration: NOT SET

Run 'npm run dev -- setup' to configure LLM.
`;
    }

    const maskedKey = config.api_key.slice(0, 8) + "..." + config.api_key.slice(-4);

    return `
LLM Configuration
═══════════════════════════════════════
Provider:    ${config.provider.toUpperCase()}
Model:       ${config.model}
Max Tokens:  ${config.max_tokens}
Temperature: ${config.temperature}
Base URL:    ${config.base_url}
API Key:     ${maskedKey}

Config file: ~/.config/cognex/llm-config.json
`;
}
