-- Temporal Memory System Database Schema
-- SQLite database for long-term memory, links, and reflection tracking

-- Long-term memories table
CREATE TABLE IF NOT EXISTS long_term_memories (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,  -- Serialized float array

    -- Metadata
    type TEXT NOT NULL CHECK(type IN ('episodic', 'semantic', 'procedural')),
    importance REAL NOT NULL CHECK(importance >= 0 AND importance <= 1),

    -- Emotional intensity (0 = neutral, 1 = highly emotional)
    arousal REAL NOT NULL DEFAULT 0.0 CHECK(arousal >= 0 AND arousal <= 1),

    -- Retrieval tracking
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,

    -- Tags and context
    tags TEXT NOT NULL,  -- JSON array: ["tag1", "tag2"]
    metadata TEXT, -- JSON object: { "provenance": "...", "failure_attribution": "..." }
    source TEXT NOT NULL CHECK(source IN ('user_interaction', 'autonomous_exploration', 'self_reflection', 'consolidation')),

    -- Decay parameters
    base_decay_rate REAL DEFAULT 0.05
);

-- Memory-to-memory links (graph edges)
CREATE TABLE IF NOT EXISTS memory_links (
    id TEXT PRIMARY KEY,
    from_memory_id TEXT NOT NULL,
    to_memory_id TEXT NOT NULL,

    weight REAL NOT NULL CHECK(weight >= 0 AND weight <= 1),
    link_type TEXT NOT NULL CHECK(link_type IN ('causal', 'temporal', 'semantic', 'correction', 'elaboration')),

    created_at TEXT NOT NULL,
    last_updated TEXT NOT NULL,
    co_retrieval_count INTEGER DEFAULT 0,
    initial_similarity REAL DEFAULT 0.0,

    FOREIGN KEY (from_memory_id) REFERENCES long_term_memories(id) ON DELETE CASCADE,
    FOREIGN KEY (to_memory_id) REFERENCES long_term_memories(id) ON DELETE CASCADE,
    UNIQUE(from_memory_id, to_memory_id)
);

-- Short-term memory slots (active context)
CREATE TABLE IF NOT EXISTS short_term_context (
    memory_id TEXT PRIMARY KEY,
    loaded_at TEXT NOT NULL,
    ttl_seconds INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    retrieval_weight REAL NOT NULL,

    FOREIGN KEY (memory_id) REFERENCES long_term_memories(id) ON DELETE CASCADE
);

-- Self-reflection log
CREATE TABLE IF NOT EXISTS reflections (
    id TEXT PRIMARY KEY,
    reflected_at TEXT NOT NULL,
    trigger TEXT NOT NULL CHECK(trigger IN ('scheduled', 'error_detected', 'goal_achieved', 'manual')),

    -- Outputs
    insights TEXT NOT NULL,  -- JSON array
    personality_updates TEXT,  -- JSON object
    memories_consolidated TEXT,  -- JSON array of memory IDs

    duration_ms INTEGER NOT NULL
);

-- System metadata for tracking state
CREATE TABLE IF NOT EXISTS system_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_created ON long_term_memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON long_term_memories(last_accessed);
CREATE INDEX IF NOT EXISTS idx_memories_type ON long_term_memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON long_term_memories(importance);

CREATE INDEX IF NOT EXISTS idx_links_from ON memory_links(from_memory_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON memory_links(to_memory_id);
CREATE INDEX IF NOT EXISTS idx_links_weight ON memory_links(weight);

CREATE INDEX IF NOT EXISTS idx_stm_expires ON short_term_context(expires_at);

CREATE INDEX IF NOT EXISTS idx_reflections_time ON reflections(reflected_at);

-- Initialize system metadata
INSERT OR IGNORE INTO system_metadata (key, value, updated_at)
VALUES ('last_reflection', '', datetime('now'));

INSERT OR IGNORE INTO system_metadata (key, value, updated_at)
VALUES ('interaction_count', '0', datetime('now'));

INSERT OR IGNORE INTO system_metadata (key, value, updated_at)
VALUES ('schema_version', '1.0', datetime('now'));

-- FTS5 Full-Text Search for BM25 retrieval
-- This enables fast keyword-based search alongside embedding search
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    content,
    tags,
    type,
    content='long_term_memories',
    content_rowid='rowid'
);

-- Triggers to keep FTS index in sync with main table
-- Insert trigger
CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON long_term_memories BEGIN
    INSERT INTO memory_fts(rowid, content, tags, type)
    VALUES (NEW.rowid, NEW.content, NEW.tags, NEW.type);
END;

-- Delete trigger
CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON long_term_memories BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content, tags, type)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.tags, OLD.type);
END;

-- Update trigger
CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON long_term_memories BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, content, tags, type)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.tags, OLD.type);
    INSERT INTO memory_fts(rowid, content, tags, type)
    VALUES (NEW.rowid, NEW.content, NEW.tags, NEW.type);
END;

-- Hypotheses table for causal learning
-- Stores learned hypotheses about what works/doesn't work
CREATE TABLE IF NOT EXISTS hypotheses (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    hypothesis TEXT NOT NULL,           -- e.g., "Humor works in m/gaming"

    -- Evidence tracking
    evidence_for INTEGER DEFAULT 0,     -- Times confirmed
    evidence_against INTEGER DEFAULT 0, -- Times refuted
    confidence REAL DEFAULT 0.5,        -- Bayesian posterior (0-1)

    -- Context for matching
    context TEXT NOT NULL,              -- JSON: {action_type, submolt, topic, ...}

    -- Lifecycle
    last_tested TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'confirmed', 'refuted', 'dormant'))
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON hypotheses(status);
CREATE INDEX IF NOT EXISTS idx_hypotheses_confidence ON hypotheses(confidence);

-- Initialize consolidation metadata
INSERT OR IGNORE INTO system_metadata (key, value, updated_at)
VALUES ('last_consolidation', '', datetime('now'));
