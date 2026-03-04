import { describe, it, expect } from 'vitest';
import { cosineSimilarity, serializeEmbedding, deserializeEmbedding } from '../src/agent/core/temporal/embedding';

describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
        const v = [0.1, 0.2, 0.3, 0.4, 0.5];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('should return 0.0 for orthogonal vectors', () => {
        const a = [1, 0, 0];
        const b = [0, 1, 0];
        expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it('should return -1.0 for opposite vectors', () => {
        const a = [1, 2, 3];
        const b = [-1, -2, -3];
        expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it('should return 0 for zero vector', () => {
        const a = [1, 2, 3];
        const zero = [0, 0, 0];
        expect(cosineSimilarity(a, zero)).toBe(0);
    });

    it('should throw on dimension mismatch', () => {
        const a = [1, 2, 3];
        const b = [1, 2];
        expect(() => cosineSimilarity(a, b)).toThrow('dimension mismatch');
    });

    it('should be symmetric', () => {
        const a = [0.3, 0.7, 0.1, 0.9];
        const b = [0.5, 0.2, 0.8, 0.4];
        expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
    });
});

describe('serializeEmbedding / deserializeEmbedding', () => {
    it('should round-trip a 384-dim embedding', () => {
        const original = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1));
        const buffer = serializeEmbedding(original);
        const restored = deserializeEmbedding(buffer);

        expect(restored).toHaveLength(384);
        for (let i = 0; i < original.length; i++) {
            expect(restored[i]).toBeCloseTo(original[i], 5);
        }
    });

    it('should produce a buffer of size length * 4 bytes', () => {
        const embedding = new Array(384).fill(0.5);
        const buffer = serializeEmbedding(embedding);
        expect(buffer.length).toBe(384 * 4);
    });

    it('should handle zeros correctly', () => {
        const zeros = new Array(10).fill(0);
        const buffer = serializeEmbedding(zeros);
        const restored = deserializeEmbedding(buffer);
        expect(restored).toEqual(zeros);
    });

    it('should handle negative values correctly', () => {
        const negatives = [-1.5, -0.5, 0, 0.5, 1.5];
        const buffer = serializeEmbedding(negatives);
        const restored = deserializeEmbedding(buffer);
        for (let i = 0; i < negatives.length; i++) {
            expect(restored[i]).toBeCloseTo(negatives[i], 5);
        }
    });
});
