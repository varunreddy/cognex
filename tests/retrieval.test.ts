import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Setup test database path before importing
const testDbPath = path.join(__dirname, 'test_retrieval.db');
process.env.TEMPORAL_MEMORY_PATH = testDbPath;

import { computeRetrievalWeight, spreadingActivation } from '../src/agent/core/temporal/retrieval';
import { LongTermMemory, MemorySearchResult } from '../src/agent/core/temporal/memoryTypes';
import { initializeDatabase, createMemory, createLink, getMemory, closeDatabase } from '../src/agent/core/temporal/memoryStore';

function cleanupTestDb() {
    for (const suffix of ['', '-wal', '-shm']) {
        const p = testDbPath + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
}

describe('Retrieval Tests', () => {
    beforeAll(() => {
        cleanupTestDb();
        initializeDatabase();
    });

    afterAll(() => {
        closeDatabase();
        cleanupTestDb();
    });

    it('should cap recency penalty in computeRetrievalWeight', () => {
        const now = new Date();

        // Memory 1: 10 days old (should hit the 120 hour cap)
        const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
        const oldMemory: LongTermMemory = {
            id: 'old_mem',
            created_at: oldDate.toISOString(),
            content: 'Very old memory',
            embedding: [],
            type: 'episodic',
            importance: 0.5,
            arousal: 0,
            access_count: 0,
            last_accessed: oldDate.toISOString(),
            tags: [],
            source: 'user_interaction',
            base_decay_rate: 0.05
        };

        // Memory 2: 5 days old (exactly 120 hours)
        const capDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        const capMemory: LongTermMemory = {
            id: 'cap_mem',
            created_at: capDate.toISOString(),
            content: 'Cap memory',
            embedding: [],
            type: 'episodic',
            importance: 0.5,
            arousal: 0,
            access_count: 0,
            last_accessed: capDate.toISOString(),
            tags: [],
            source: 'user_interaction',
            base_decay_rate: 0.05
        };

        const weightOld = computeRetrievalWeight(oldMemory, { beta: 0.1 });
        const weightCap = computeRetrievalWeight(capMemory, { beta: 0.1 });

        expect(weightOld).toBeCloseTo(weightCap, 5);
        expect(weightOld).toBeGreaterThan(0);
        expect(weightOld).toBeLessThan(1);
    });

    it('spreadingActivation should use relevance_score for seed activation and propagate through graph links', () => {
        // Create two memories and link them
        const embedding = new Array(384).fill(0.1);

        const mem1Id = createMemory({
            created_at: new Date().toISOString(),
            content: 'Seed memory for spreading activation',
            embedding,
            type: 'episodic',
            importance: 0.8,
            arousal: 0,
            tags: [],
            source: 'user_interaction',
            base_decay_rate: 0.05
        });

        const mem2Id = createMemory({
            created_at: new Date().toISOString(),
            content: 'Linked memory for spreading activation',
            embedding,
            type: 'episodic',
            importance: 0.6,
            arousal: 0,
            tags: [],
            source: 'user_interaction',
            base_decay_rate: 0.05
        });

        // Create a strong link from mem1 to mem2
        createLink({
            from_memory_id: mem1Id,
            to_memory_id: mem2Id,
            weight: 0.8,
            link_type: 'semantic',
            created_at: new Date().toISOString(),
            last_updated: new Date().toISOString(),
            co_retrieval_count: 3,
            initial_similarity: 0.7
        });

        // Build seed memories with relevance_score
        const seedMemory = getMemory(mem1Id)!;
        const seedResults: MemorySearchResult[] = [{
            memory: seedMemory,
            similarity: 0.9,
            retrieval_weight: 0.8,
            relevance_score: 0.85,
        }];

        const activated = spreadingActivation(seedResults, { spread_depth: 2, link_threshold: 0.3 });

        // Seed memory should be activated with its relevance_score
        const seedActivated = activated.get(mem1Id);
        expect(seedActivated).toBeDefined();
        expect(seedActivated!.activation).toBe(0.85);
        expect(seedActivated!.depth).toBe(0);

        // Linked memory should be activated via propagation
        const linkedActivated = activated.get(mem2Id);
        expect(linkedActivated).toBeDefined();
        expect(linkedActivated!.depth).toBe(1);
        // Activation should be: seedActivation * initial_similarity * hopDecay = 0.85 * 0.7 * 0.7
        expect(linkedActivated!.activation).toBeCloseTo(0.85 * 0.7 * 0.7, 5);
    });
});
