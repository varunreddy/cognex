/**
 * Embedding utilities for semantic search
 * Uses OpenAI's embedding API (same config as agent LLM)
 */

import { loadLLMConfig } from '../llmConfig';
import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;
let embeddingClient: OpenAI | null = null;

function getEmbeddingClient(): OpenAI {
    if (!embeddingClient) {
        const config = loadLLMConfig();
        const apiKey = config?.embedding_api_key || config?.api_key;
        const baseURL = config?.embedding_base_url || config?.base_url || 'https://api.openai.com/v1';

        if (!apiKey) {
            throw new Error('API key not configured. Run: npm run dev -- setup');
        }

        embeddingClient = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
        });
    }
    return embeddingClient;
}

/**
 * Generate embedding for a text string
 * Uses text-embedding-3-small (1536 dimensions, $0.02/1M tokens)
 */

// Local pipeline singleton
let localExtractor: any = null;

async function getLocalExtractor() {
    if (!localExtractor) {
        console.log("[EMBEDDING] Loading local model (Xenova/all-MiniLM-L6-v2)...");
        // Dynamically import to avoid build issues if package is missing
        const { pipeline } = await import('@xenova/transformers');
        localExtractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return localExtractor;
}

export async function generateEmbedding(text: string): Promise<number[]> {
    const config = loadLLMConfig();
    const provider = config?.embedding_provider || (config?.api_key ? 'openai' : 'local');

    // LOCAL EMBEDDING
    if (provider === 'local') {
        try {
            const extractor = await getLocalExtractor();
            const output = await extractor(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        } catch (error: any) {
            console.error(`[EMBEDDING] Local generation failed:`, error.message);
            throw error;
        }
    }

    // OPENAI COMPATIBLE EMBEDDING
    const client = getEmbeddingClient();
    const model = config?.embedding_model || 'text-embedding-3-small';

    try {
        const response = await client.embeddings.create({
            model: model,
            input: text,
            encoding_format: 'float',
        });

        return response.data[0].embedding;
    } catch (error: any) {
        console.error(`[EMBEDDING] Failed to generate (${model}):`, error.message);
        throw error;
    }
}

/**
 * Generate multiple embeddings in a single API call (more efficient)
 */
export async function batchEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await generateEmbedding(texts[0])];

    const config = loadLLMConfig();
    const provider = config?.embedding_provider || (config?.api_key ? 'openai' : 'local');

    // LOCAL EMBEDDING
    if (provider === 'local') {
        try {
            const extractor = await getLocalExtractor();
            const embeddings: number[][] = [];

            // Xenova doesn't support batch input natively for feature-extraction in all versions,
            // so we iterate (it operates locally so HTTP overhead isn't an issue).
            for (const text of texts) {
                const output = await extractor(text, { pooling: 'mean', normalize: true });
                embeddings.push(Array.from(output.data));
            }
            return embeddings;

        } catch (error: any) {
            console.error(`[EMBEDDING] Local batch generation failed:`, error.message);
            throw error;
        }
    }

    const client = getEmbeddingClient();
    const model = config?.embedding_model || 'text-embedding-3-small';

    try {
        const response = await client.embeddings.create({
            model: model,
            input: texts,
            encoding_format: 'float',
        });

        // Sort by index to ensure order matches input
        return response.data
            .sort((a, b) => a.index - b.index)
            .map(item => item.embedding);
    } catch (error: any) {
        console.error(`[EMBEDDING] Batch generation failed (${model}):`, error.message);
        throw error;
    }
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns value in range [-1, 1], where 1 = identical, 0 = orthogonal, -1 = opposite
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (normA * normB);
}

/**
 * Serialize embedding vector to Buffer for SQLite storage
 */
export function serializeEmbedding(embedding: number[]): Buffer {
    const buffer = Buffer.allocUnsafe(embedding.length * 4); // 4 bytes per float32
    for (let i = 0; i < embedding.length; i++) {
        buffer.writeFloatLE(embedding[i], i * 4);
    }
    return buffer;
}

/**
 * Deserialize embedding vector from SQLite Buffer
 */
export function deserializeEmbedding(buffer: Buffer): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
        embedding.push(buffer.readFloatLE(i));
    }
    return embedding;
}
