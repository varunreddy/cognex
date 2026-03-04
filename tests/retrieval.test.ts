import { describe, it, expect } from 'vitest';
import { computeRetrievalWeight } from '../src/agent/core/temporal/retrieval';
import { LongTermMemory } from '../src/agent/core/temporal/memoryTypes';

describe('Retrieval Tests', () => {
    it('should cap recency penalty in computeRetrievalWeight', () => {
        const now = new Date();

        // Memory 1: 10 days old (should hit the 120 hour cap)
        const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 240 hours
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
        const capDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 120 hours
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

        // Since the recency penalty is capped at 120 hours, a 240 hour old memory 
        // should have the exact same retrieval weight as a 120 hour old memory 
        // (assuming other factors like access frequency and importance are equal).
        expect(weightOld).toBeCloseTo(weightCap, 5);
        expect(weightOld).toBeGreaterThan(0); // Ensure bounded between 0 and 1
        expect(weightOld).toBeLessThan(1);
    });
});
