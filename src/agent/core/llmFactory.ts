/**
 * LLM Factory
 * Creates and configures language model instances
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseMessage } from "@langchain/core/messages";
import { loadLLMConfig, LLMConfig as StoredLLMConfig } from "./llmConfig";
import * as dotenv from "dotenv";

dotenv.config();

export interface LLMOptions {
    jsonMode?: boolean;
    overrideConfig?: Partial<StoredLLMConfig>;
}

export function getLLM(options: LLMOptions = {}): BaseChatModel {
    // Load saved config or fall back to env vars
    const savedConfig = loadLLMConfig();
    const override = options.overrideConfig || {};

    const provider = override.provider || savedConfig?.provider ||
        (process.env.LLM_PROVIDER as any) || "openai";

    const model = override.model || savedConfig?.model ||
        process.env.MODEL_NAME ||
        (provider === "openai" ? "gpt-4o" :
            provider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gpt-4o");

    const temperature = override.temperature ?? savedConfig?.temperature ??
        parseFloat(process.env.TEMPERATURE || "0.7");

    const maxTokens = override.max_tokens ?? savedConfig?.max_tokens ?? 4096;

    const apiKey = override.api_key || savedConfig?.api_key ||
        (provider === "openai" ? process.env.OPENAI_API_KEY :
            provider === "anthropic" ? process.env.ANTHROPIC_API_KEY :
                process.env.OPENAI_API_KEY) || "";

    const baseUrl = override.base_url || savedConfig?.base_url || process.env.OPENAI_BASE_URL;

    if (!apiKey) {
        throw new Error(
            `API Key for ${provider} is missing.\n` +
            `Run 'npm run dev -- setup' to configure LLM, or set OPENAI_API_KEY in .env`
        );
    }

    console.log(`[LLM] Using ${provider} / ${model}`);

    if (provider === "anthropic") {
        return new ChatAnthropic({
            modelName: model,
            temperature,
            maxTokens,
            anthropicApiKey: apiKey,
        });
    }

    // OpenAI, Groq, Fireworks, Together, or custom (all OpenAI-compatible)
    return new ChatOpenAI({
        modelName: model,
        temperature,
        maxTokens,
        apiKey,
        configuration: baseUrl ? { baseURL: baseUrl } : undefined,
        ...(options.jsonMode ? { modelKwargs: { response_format: { type: "json_object" } } } : {}),
    });
}

export async function invokeLLM(llm: BaseChatModel, prompt: string | BaseMessage[]): Promise<string> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await llm.invoke(prompt);
            let content = typeof response.content === "string"
                ? response.content
                : JSON.stringify(response.content);

            // Strip thinking tags if present
            content = content.replace(/<think>[\s\S]*?<\/think>/gi, "");

            return content.trim();
        } catch (error: any) {
            attempt++;
            const isNetworkError = error.message?.includes("fetch failed") ||
                error.message?.includes("EAI_AGAIN") ||
                error.message?.includes("ETIMEDOUT") ||
                error.code === "APIConnectionError";

            if (isNetworkError && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                console.warn(`[LLM] Connection failed (Attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error("LLM invocation failed after max retries");
}
