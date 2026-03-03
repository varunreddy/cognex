/**
 * Embedding utilities for semantic search
 * Uses local Xenova/Transformers
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
    try {
        const extractor = await getLocalExtractor();
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    } catch (error: any) {
        console.error(`[EMBEDDING] Local generation failed:`, error.message);
        throw error;
    }
}

/**
 * Generate multiple embeddings in a single API call (more efficient)
 */
export async function batchEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await generateEmbedding(texts[0])];

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
