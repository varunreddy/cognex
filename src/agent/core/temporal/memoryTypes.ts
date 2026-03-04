/**
 * Type definitions for the temporal memory system
 */

export interface LongTermMemory {
    id: string;
    created_at: string; // ISO 8601 timestamp
    content: string;
    embedding: number[]; // Vector embedding (e.g., 1536 dimensions)

    // Memory classification
    type: 'episodic' | 'semantic' | 'procedural';
    importance: number; // 0.0 - 1.0

    // Emotional intensity (0-1). High absolute sentiment → high arousal.
    // Both positive and negative emotions score high; neutral content scores low.
    arousal: number;

    // Retrieval tracking
    access_count: number;
    last_accessed: string | null; // ISO 8601 timestamp

    // Context and metadata
    tags: string[]; // e.g., ["self_reflection", "goal_update"]
    metadata?: Record<string, any> | HypothesisMetadata; // Generic metadata (provenance, failure attribution, etc.)
    source: 'user_interaction' | 'autonomous_exploration' | 'self_reflection' | 'consolidation' | 'search';

    // Decay parameters
    base_decay_rate: number; // Default: 0.05
}

export interface HypothesisMetadata {
    memory_type: 'hypothesis';
    evidence_count: number;
    last_tested: string;   // ISO 8601 timestamp
    confidence: number;    // 0.0 - 1.0
    status: 'active' | 'confirmed' | 'refuted' | 'stale';
}

export interface MemoryLink {
    id: string;
    from_memory_id: string;
    to_memory_id: string;

    weight: number; // 0.0 - 1.0 (logistic function output)
    link_type: 'causal' | 'temporal' | 'semantic' | 'correction' | 'elaboration';

    created_at: string;
    last_updated: string;
    co_retrieval_count: number;
    initial_similarity: number; // Cosine similarity from embeddings
}

export interface ShortTermSlot {
    memory_id: string;
    loaded_at: string;
    ttl_seconds: number;
    expires_at: string;
    retrieval_weight: number;
}

export interface ReflectionOutput {
    id: string;
    reflected_at: string;
    trigger: 'scheduled' | 'error_detected' | 'goal_achieved' | 'manual';

    // Outputs
    insights: string[]; // Generated insights
    personality_updates: Record<string, number>; // Parameter changes
    memories_consolidated: string[]; // Memory IDs merged/promoted
    belief_correction?: string; // Optional context to trigger belief recovery (e.g. "Fixed API Key")

    duration_ms: number;
}

export interface ActivatedMemory {
    memory: LongTermMemory;
    activation: number; // How strongly activated (0-1)
    depth: number; // Hops from primary query
}

export interface MemorySearchResult {
    memory: LongTermMemory;
    similarity: number; // Cosine similarity to query
    retrieval_weight: number; // Logistic weight
    rrf_score?: number; // Reciprocal Rank Fusion score (for hybrid search)
    relevance_score?: number; // Final reranked relevance score (0-1)
}

export interface MemoryStats {
    total_memories: number;
    episodic_count: number;
    semantic_count: number;
    procedural_count: number;
    total_links: number;
    avg_link_weight: number;
    short_term_active: number;
    last_reflection: string | null;
    total_reflections: number;
}

export interface RetrievalParams {
    alpha: number; // Frequency weight (default: 0.5)
    beta: number; // Recency decay (default: 0.1)
    min_ttl: number; // Min short-term TTL in seconds (default: 60)
    max_ttl: number; // Max short-term TTL in seconds (default: 3600)
    link_threshold: number; // Min weight to traverse (default: 0.3)
    spread_depth: number; // Max hops in graph (default: 2)
}
