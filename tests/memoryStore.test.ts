import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Setup test database path before importing memoryStore
const testDbPath = path.join(__dirname, 'test_memory.db');
process.env.TEMPORAL_MEMORY_PATH = testDbPath;

import {
    initializeDatabase,
    createMemory,
    getMemory,
    deleteMemory,
    getAllMemories,
    getMemoryStats,
    bm25Search,
    createLink,
    updateMemoryMetadata,
    closeDatabase
} from '../src/agent/core/temporal/memoryStore';

function cleanupTestDb() {
    for (const suffix of ['', '-wal', '-shm']) {
        const p = testDbPath + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

describe('Memory Store Tests', () => {
    beforeAll(() => {
        cleanupTestDb();
        initializeDatabase();
    });

    afterAll(() => {
        closeDatabase();
        cleanupTestDb();
    });

    it('should save and retrieve memory with source: "search"', () => {
        const id = createMemory({
            created_at: new Date().toISOString(),
            content: 'Test search memory',
            embedding: new Array(384).fill(0.1),
            type: 'episodic',
            importance: 0.8,
            arousal: 0,
            tags: ['test'],
            source: 'search',
            base_decay_rate: 0.05
        });

        const mem = getMemory(id);
        expect(mem).toBeDefined();
        expect(mem?.source).toBe('search');
    });

    it('bm25Search should return metadata correctly', () => {
        const id = createMemory({
            created_at: new Date().toISOString(),
            content: 'Unique bm25 testing phrase',
            embedding: new Array(384).fill(0.1),
            type: 'semantic',
            importance: 0.9,
            arousal: 0,
            tags: ['bm25'],
            metadata: { provenance: 'test_suit' },
            source: 'user_interaction',
            base_decay_rate: 0.05
        });

        const results = bm25Search('Unique bm25 testing phrase', 5);
        expect(results.length).toBeGreaterThan(0);

        const matchedMem = results.find(r => r.memory.id === id);
        expect(matchedMem).toBeDefined();
        expect(matchedMem?.memory.metadata).toBeDefined();
        expect((matchedMem?.memory.metadata as any)?.provenance).toBe('test_suit');
    });

    it('createLink should return the same valid ID on conflict', () => {
        const mem1 = createMemory({
            created_at: new Date().toISOString(),
            content: 'Memory 1',
            embedding: new Array(384).fill(0.1),
            type: 'episodic',
            importance: 0.5,
            arousal: 0,
            tags: [],
            source: 'user_interaction',
            base_decay_rate: 0.05
        });

        const mem2 = createMemory({
            created_at: new Date().toISOString(),
            content: 'Memory 2',
            embedding: new Array(384).fill(0.1),
            type: 'episodic',
            importance: 0.5,
            arousal: 0,
            tags: [],
            source: 'user_interaction',
            base_decay_rate: 0.05
        });

        const linkId1 = createLink({
            from_memory_id: mem1,
            to_memory_id: mem2,
            weight: 0.5,
            link_type: 'semantic',
            created_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            co_retrieval_count: 1,
            initial_similarity: 0.5
        });

        expect(linkId1).toBeDefined();

        // This should trigger the ON CONFLICT clause
        const linkId2 = createLink({
            from_memory_id: mem1,
            to_memory_id: mem2,
            weight: 0.8,
            link_type: 'semantic',
            created_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            co_retrieval_count: 2,
            initial_similarity: 0.5
        });

        expect(linkId2).toBe(linkId1); // Should return the exact same ID
    });

    it('updateMemoryMetadata should merge new data without destroying existing properties', () => {
        const id = createMemory({
            created_at: new Date().toISOString(),
            content: 'Testing partial metadata update',
            embedding: new Array(384).fill(0.1),
            type: 'semantic',
            importance: 0.8,
            arousal: 0,
            tags: [],
            metadata: { original_key: 'original_val' },
            source: 'user_interaction',
            base_decay_rate: 0.05
        });

        updateMemoryMetadata(id, { new_key: 'new_val' });

        const updatedMem = getMemory(id);
        expect(updatedMem).toBeDefined();
        expect((updatedMem?.metadata as any)?.original_key).toBe('original_val');
        expect((updatedMem?.metadata as any)?.new_key).toBe('new_val');
    });

    it('deleteMemory should return true and memory should be gone', () => {
        const id = createMemory({
            created_at: new Date().toISOString(),
            content: 'Memory to delete',
            embedding: new Array(384).fill(0.1),
            type: 'episodic',
            importance: 0.5,
            arousal: 0,
            tags: [],
            source: 'user_interaction',
            base_decay_rate: 0.05
        });

        expect(getMemory(id)).toBeDefined();
        const result = deleteMemory(id);
        expect(result).toBe(true);
        expect(getMemory(id)).toBeNull();
    });

    it('deleteMemory should return false for nonexistent ID', () => {
        const result = deleteMemory('nonexistent-id-12345');
        expect(result).toBe(false);
    });

    it('getMemoryStats should reflect correct counts', () => {
        const stats = getMemoryStats();
        expect(stats.total_memories).toBeGreaterThan(0);
        expect(stats.episodic_count).toBeGreaterThanOrEqual(0);
        expect(stats.semantic_count).toBeGreaterThanOrEqual(0);
        expect(stats.total_memories).toBe(
            stats.episodic_count + stats.semantic_count + stats.procedural_count
        );
    });

    it('getAllMemories should respect limit', () => {
        // Create a few extra memories to ensure we have enough
        for (let i = 0; i < 3; i++) {
            createMemory({
                created_at: new Date().toISOString(),
                content: `Limit test memory ${i}`,
                embedding: new Array(384).fill(0.1),
                type: 'episodic',
                importance: 0.5,
                arousal: 0,
                tags: [],
                source: 'user_interaction',
                base_decay_rate: 0.05
            });
        }

        const limited = getAllMemories(2);
        expect(limited).toHaveLength(2);

        const all = getAllMemories(100);
        expect(all.length).toBeGreaterThan(2);
    });
});
