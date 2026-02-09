/**
 * Hypothesis Learning - Causal Understanding System
 * 
 * Enables the agent to form hypotheses about what works (and doesn't),
 * track evidence for/against, and update beliefs using Bayesian inference.
 * 
 * Example hypotheses:
 * - "Humor works better in m/gaming" (context: {submolt: "gaming"})
 * - "Long posts get fewer upvotes" (context: {content_length: "long"})
 * 
 * Lifecycle:
 *   Observation → Hypothesis Formation → Testing → Confirmed/Refuted → Prune/Persist
 */

import { isDisabled } from '../../../eval/evalConfig.js';
import { v4 as uuidv4 } from 'uuid';
import { initializeDatabase } from './memoryStore';
import Database from 'better-sqlite3';

// Module-level DB reference
let db: Database.Database | null = null;

function getDB(): Database.Database {
    if (!db) {
        db = initializeDatabase();
    }
    return db;
}

// Types
export interface Hypothesis {
    id: string;
    created_at: string;
    hypothesis: string;
    evidence_for: number;
    evidence_against: number;
    confidence: number;  // 0-1, Bayesian posterior
    context: HypothesisContext;
    last_tested: string | null;
    status: 'active' | 'confirmed' | 'refuted' | 'dormant';
}

export interface HypothesisContext {
    action_type?: string;      // e.g., "create_comment", "create_post"
    submolt?: string;          // e.g., "gaming", "techagents"
    topic?: string;            // e.g., "ai", "humor"
    content_style?: string;    // e.g., "long", "short", "question"
}

export interface ActionOutcome {
    action_type: string;
    success: boolean;           // Did it produce positive feedback?
    upvotes?: number;
    replies?: number;
    moderation_flag?: boolean;
    context: {
        submolt?: string;
        topic?: string;
        content_length?: number;
        has_humor?: boolean;
    };
}

// Constants
const HYPOTHESES_ENABLED = false;  // DISABLED: Moltbook bot environment provides meaningless feedback
const CONFIRMATION_THRESHOLD = 0.8;   // Confidence above this = confirmed
const REFUTATION_THRESHOLD = 0.2;     // Confidence below this = refuted
const MIN_TESTS_FOR_CONCLUSION = 5;   // Minimum tests before status change
const DORMANCY_DAYS = 30;             // Days without testing → dormant
const PRIOR_STRENGTH = 2;             // Equivalent prior observations (Beta(2,2))

/**
 * Create a new hypothesis
 */
export function createHypothesis(
    hypothesisText: string,
    context: HypothesisContext
): string {
    initializeDatabase();
    const db = getDB();
    const id = uuidv4();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
        INSERT INTO hypotheses (id, created_at, hypothesis, confidence, context, status)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, now, hypothesisText, 0.5, JSON.stringify(context), 'active');
    console.log(`[HYPOTHESIS] Created: "${hypothesisText.slice(0, 50)}..."`);

    return id;
}

/**
 * Get hypothesis by ID
 */
export function getHypothesis(id: string): Hypothesis | null {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM hypotheses WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
        id: row.id,
        created_at: row.created_at,
        hypothesis: row.hypothesis,
        evidence_for: row.evidence_for,
        evidence_against: row.evidence_against,
        confidence: row.confidence,
        context: JSON.parse(row.context),
        last_tested: row.last_tested,
        status: row.status,
    };
}

/**
 * Get all active hypotheses
 */
export function getActiveHypotheses(): Hypothesis[] {
    const db = getDB();
    const stmt = db.prepare("SELECT * FROM hypotheses WHERE status = 'active' ORDER BY confidence DESC");
    const rows = stmt.all() as any[];

    return rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        hypothesis: row.hypothesis,
        evidence_for: row.evidence_for,
        evidence_against: row.evidence_against,
        confidence: row.confidence,
        context: JSON.parse(row.context),
        last_tested: row.last_tested,
        status: row.status,
    }));
}

/**
 * Find hypotheses that match a given context
 */
export function findMatchingHypotheses(context: HypothesisContext): Hypothesis[] {
    const active = getActiveHypotheses();

    return active.filter(h => {
        const hContext = h.context;

        // Check if hypothesis context matches action context
        if (hContext.action_type && context.action_type &&
            hContext.action_type !== context.action_type) {
            return false;
        }

        if (hContext.submolt && context.submolt &&
            hContext.submolt !== context.submolt) {
            return false;
        }

        if (hContext.topic && context.topic &&
            hContext.topic !== context.topic) {
            return false;
        }

        return true;
    });
}

/**
 * Update hypothesis with new evidence using Bayesian update
 * 
 * Uses Beta-Binomial model:
 *   Prior: Beta(α, β) where α = PRIOR_STRENGTH, β = PRIOR_STRENGTH
 *   Posterior: Beta(α + successes, β + failures)
 *   Confidence = α / (α + β)
 */
export function updateHypothesis(id: string, wasSuccessful: boolean): void {
    const db = getDB();
    const hypothesis = getHypothesis(id);
    if (!hypothesis) return;

    const now = new Date().toISOString();

    // Update evidence counts
    const newEvidenceFor = hypothesis.evidence_for + (wasSuccessful ? 1 : 0);
    const newEvidenceAgainst = hypothesis.evidence_against + (wasSuccessful ? 0 : 1);

    // Bayesian update: Beta posterior
    const alpha = PRIOR_STRENGTH + newEvidenceFor;
    const beta = PRIOR_STRENGTH + newEvidenceAgainst;
    const newConfidence = alpha / (alpha + beta);

    // Determine new status
    const totalTests = newEvidenceFor + newEvidenceAgainst;
    let newStatus = hypothesis.status;

    if (totalTests >= MIN_TESTS_FOR_CONCLUSION) {
        if (newConfidence >= CONFIRMATION_THRESHOLD) {
            newStatus = 'confirmed';
            console.log(`[HYPOTHESIS] CONFIRMED: "${hypothesis.hypothesis.slice(0, 50)}..." (confidence: ${newConfidence.toFixed(2)})`);
        } else if (newConfidence <= REFUTATION_THRESHOLD) {
            newStatus = 'refuted';
            console.log(`[HYPOTHESIS] REFUTED: "${hypothesis.hypothesis.slice(0, 50)}..." (confidence: ${newConfidence.toFixed(2)})`);
        }
    }

    // Update database
    const stmt = db.prepare(`
        UPDATE hypotheses 
        SET evidence_for = ?, evidence_against = ?, confidence = ?, last_tested = ?, status = ?
        WHERE id = ?
    `);

    stmt.run(newEvidenceFor, newEvidenceAgainst, newConfidence, now, newStatus, id);
}

/**
 * Process an action outcome and update relevant hypotheses
 */
export function processOutcome(outcome: ActionOutcome): void {
    // disabled globally or via eval config
    if (!HYPOTHESES_ENABLED || isDisabled('disableHypotheses')) return;

    // Find matching hypotheses
    const context: HypothesisContext = {
        action_type: outcome.action_type,
        submolt: outcome.context.submolt,
        topic: outcome.context.topic,
    };

    const matching = findMatchingHypotheses(context);

    // Update each matching hypothesis
    for (const hypothesis of matching) {
        updateHypothesis(hypothesis.id, outcome.success);
    }

    // Check if we should form new hypotheses based on surprising outcomes
    if (matching.length === 0 && outcome.success) {
        maybeFormHypothesis(outcome);
    }
}

/**
 * Attempt to form a new hypothesis from a successful outcome
 */
function maybeFormHypothesis(outcome: ActionOutcome): void {
    // Only form hypotheses for notable successes
    const notableSuccess = (outcome.upvotes ?? 0) >= 5 || (outcome.replies ?? 0) >= 2;

    if (!notableSuccess) return;

    // Form hypothesis based on context
    if (outcome.context.submolt) {
        const hypothesisText = `${outcome.action_type} performs well in m/${outcome.context.submolt}`;
        createHypothesis(hypothesisText, {
            action_type: outcome.action_type,
            submolt: outcome.context.submolt,
        });
    }

    if (outcome.context.topic) {
        const hypothesisText = `Content about "${outcome.context.topic}" gets good engagement`;
        createHypothesis(hypothesisText, {
            topic: outcome.context.topic,
        });
    }

    if (outcome.context.has_humor) {
        const hypothesisText = `Humor works well for ${outcome.action_type}`;
        createHypothesis(hypothesisText, {
            action_type: outcome.action_type,
            content_style: 'humorous',
        });
    }
}

/**
 * Mark dormant hypotheses that haven't been tested recently
 */
export function markDormantHypotheses(): number {
    const db = getDB();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DORMANCY_DAYS);
    const cutoff = cutoffDate.toISOString();

    const stmt = db.prepare(`
        UPDATE hypotheses 
        SET status = 'dormant'
        WHERE status = 'active' 
          AND (last_tested IS NULL OR last_tested < ?)
          AND created_at < ?
    `);

    const result = stmt.run(cutoff, cutoff);

    if (result.changes > 0) {
        console.log(`[HYPOTHESIS] Marked ${result.changes} hypotheses as dormant`);
    }

    return result.changes;
}

/**
 * Get hypotheses summary for inclusion in prompts
 */
export function getHypothesesSummary(): string {
    const active = getActiveHypotheses();

    if (active.length === 0) {
        return '';
    }

    // Get top confirmed and high-confidence active hypotheses
    const confirmed = active.filter(h => h.status === 'confirmed').slice(0, 3);
    const highConfidence = active
        .filter(h => h.status === 'active' && h.confidence >= 0.7)
        .slice(0, 3);

    if (confirmed.length === 0 && highConfidence.length === 0) {
        return '';
    }

    let summary = '## Learned Patterns\n';

    if (confirmed.length > 0) {
        summary += '\n**Confirmed:**\n';
        for (const h of confirmed) {
            summary += `- ✓ ${h.hypothesis} (${Math.round(h.confidence * 100)}%)\n`;
        }
    }

    if (highConfidence.length > 0) {
        summary += '\n**Likely:**\n';
        for (const h of highConfidence) {
            summary += `- ~ ${h.hypothesis} (${Math.round(h.confidence * 100)}%)\n`;
        }
    }

    return summary;
}

/**
 * Get all hypotheses for debugging/inspection
 */
export function getAllHypotheses(): Hypothesis[] {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM hypotheses ORDER BY created_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        hypothesis: row.hypothesis,
        evidence_for: row.evidence_for,
        evidence_against: row.evidence_against,
        confidence: row.confidence,
        context: JSON.parse(row.context),
        last_tested: row.last_tested,
        status: row.status,
    }));
}
