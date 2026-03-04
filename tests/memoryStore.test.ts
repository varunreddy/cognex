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
    bm25Search,
    createLink,
    updateMemoryMetadata
} from '../src/agent/core/temporal/memoryStore';

describe('Memory Store Tests', () => {
    beforeAll(() => {
        // Clean up any existing test DB
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        initializeDatabase();
    });

    afterAll(() => {
        // Clean up test DB
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
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
            source: 'search',  // Testing the newly added source type
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

        // Add a new key via partial update
        updateMemoryMetadata(id, { new_key: 'new_val' });

        const updatedMem = getMemory(id);
        expect(updatedMem).toBeDefined();

        // Both the old and new keys should be present in metadata
        expect(updatedMem?.metadata).toBeDefined();
        expect((updatedMem?.metadata as any)?.original_key).toBe('original_val');
        expect((updatedMem?.metadata as any)?.new_key).toBe('new_val');
    });
});
