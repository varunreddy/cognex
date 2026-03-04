import { describe, it, expect } from 'vitest';
import { estimateArousal } from '../src/agent/core/temporal/arousal';

describe('Arousal Estimation', () => {
    it('should return high arousal for negative emotion words', () => {
        const arousal = estimateArousal('I am furious about this disaster');
        expect(arousal).toBeGreaterThanOrEqual(0.6);
    });

    it('should return low arousal for neutral content', () => {
        const arousal = estimateArousal('The meeting is scheduled for Tuesday at 3pm');
        expect(arousal).toBeLessThanOrEqual(0.2);
    });

    it('should use emotion label as a strong signal', () => {
        const arousal = estimateArousal('Something happened', 'ecstatic');
        expect(arousal).toBeGreaterThanOrEqual(0.9);
    });

    it('should return high arousal for positive emotion words', () => {
        const arousal = estimateArousal('This is amazing and incredible, I am thrilled!!');
        expect(arousal).toBeGreaterThanOrEqual(0.7);
    });

    it('should clamp output to [0, 1]', () => {
        // Even with many high-arousal keywords stacked, result should be <= 1
        const arousal = estimateArousal(
            'FURIOUS!! ECSTATIC!! DEVASTATED!! INCREDIBLE!! CATASTROPHE!!',
            'panicked'
        );
        expect(arousal).toBeGreaterThanOrEqual(0);
        expect(arousal).toBeLessThanOrEqual(1);
    });
});
