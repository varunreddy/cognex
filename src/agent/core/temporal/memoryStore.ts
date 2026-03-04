/**
 * Memory Store - Core database layer for temporal memory system
 * Uses better-sqlite3 for synchronous, fast SQLite operations
 * Uses sqlite-vec for O(log n) vector similarity search
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
    LongTermMemory,
    MemoryLink,
    ShortTermSlot,
    ReflectionOutput,
    MemoryStats,
} from './memoryTypes';
import { serializeEmbedding, deserializeEmbedding } from './embedding';

// Determine embedding dimension based on config
// We now strictly use Xenova local embeddings (384 dimensions)
function getMemoryDir() {
    return process.env.TEMPORAL_MEMORY_PATH
        ? path.dirname(process.env.TEMPORAL_MEMORY_PATH)
        : path.join(os.homedir(), '.config', 'cognex');
}
function getDbPath() {
    return process.env.TEMPORAL_MEMORY_PATH || path.join(getMemoryDir(), 'temporal_memory.db');
}

let db: Database.Database | null = null;
let vecExtensionLoaded = false;

function getEmbeddingDimension(): number {
    return 384;
}

/**
 * Initialize database and create schema if needed
 */
export function initializeDatabase(): Database.Database {
    if (db) return db;

    const memoryDir = getMemoryDir();
    const dbPath = getDbPath();

    // Ensure directory exists
    if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // Better concurrency

    // Load sqlite-vec extension for vector similarity search
    try {
        const sqliteVec = require('sqlite-vec');
        sqliteVec.load(db);
        vecExtensionLoaded = true;
        console.log('[MEMORY] sqlite-vec extension loaded');
    } catch (error: any) {
        console.warn(`[MEMORY] sqlite-vec not available, using brute-force search: ${error.message}`);
        vecExtensionLoaded = false;
    }

    db.exec(`CREATE TABLE IF NOT EXISTS long_term_memories (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, content TEXT NOT NULL, embedding BLOB NOT NULL, type TEXT NOT NULL CHECK(type IN ('episodic', 'semantic', 'procedural')), importance REAL NOT NULL CHECK(importance >= 0 AND importance <= 1), arousal REAL NOT NULL DEFAULT 0.0 CHECK(arousal >= 0 AND arousal <= 1), access_count INTEGER DEFAULT 0, last_accessed TEXT, tags TEXT NOT NULL, metadata TEXT, source TEXT NOT NULL CHECK(source IN ('user_interaction', 'autonomous_exploration', 'self_reflection', 'consolidation', 'search')), base_decay_rate REAL DEFAULT 0.05);`);
    db.exec(`CREATE TABLE IF NOT EXISTS memory_links (id TEXT PRIMARY KEY, from_memory_id TEXT NOT NULL, to_memory_id TEXT NOT NULL, weight REAL NOT NULL CHECK(weight >= 0 AND weight <= 1), link_type TEXT NOT NULL CHECK(link_type IN ('causal', 'temporal', 'semantic', 'correction', 'elaboration')), created_at TEXT NOT NULL, last_updated TEXT NOT NULL, co_retrieval_count INTEGER DEFAULT 0, initial_similarity REAL DEFAULT 0.0, FOREIGN KEY (from_memory_id) REFERENCES long_term_memories(id) ON DELETE CASCADE, FOREIGN KEY (to_memory_id) REFERENCES long_term_memories(id) ON DELETE CASCADE, UNIQUE(from_memory_id, to_memory_id));`);
    db.exec(`CREATE TABLE IF NOT EXISTS short_term_context (memory_id TEXT PRIMARY KEY, loaded_at TEXT NOT NULL, ttl_seconds INTEGER NOT NULL, expires_at TEXT NOT NULL, retrieval_weight REAL NOT NULL, FOREIGN KEY (memory_id) REFERENCES long_term_memories(id) ON DELETE CASCADE);`);
    db.exec(`CREATE TABLE IF NOT EXISTS reflections (id TEXT PRIMARY KEY, reflected_at TEXT NOT NULL, trigger TEXT NOT NULL CHECK(trigger IN ('scheduled', 'error_detected', 'goal_achieved', 'manual')), insights TEXT NOT NULL, personality_updates TEXT, memories_consolidated TEXT, duration_ms INTEGER NOT NULL);`);
    db.exec(`CREATE TABLE IF NOT EXISTS system_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_created ON long_term_memories(created_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_accessed ON long_term_memories(last_accessed);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_type ON long_term_memories(type);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON long_term_memories(importance);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_links_from ON memory_links(from_memory_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_links_to ON memory_links(to_memory_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_links_weight ON memory_links(weight);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_stm_expires ON short_term_context(expires_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reflections_time ON reflections(reflected_at);`);
    db.exec(`INSERT OR IGNORE INTO system_metadata (key, value, updated_at) VALUES ('last_reflection', '', datetime('now'));`);
    db.exec(`INSERT OR IGNORE INTO system_metadata (key, value, updated_at) VALUES ('interaction_count', '0', datetime('now'));`);
    db.exec(`INSERT OR IGNORE INTO system_metadata (key, value, updated_at) VALUES ('schema_version', '1.0', datetime('now'));`);
    db.exec(`INSERT OR IGNORE INTO system_metadata (key, value, updated_at) VALUES ('last_consolidation', '', datetime('now'));`);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, tags, type, content='long_term_memories', content_rowid='rowid');`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON long_term_memories BEGIN INSERT INTO memory_fts(rowid, content, tags, type) VALUES (NEW.rowid, NEW.content, NEW.tags, NEW.type); END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON long_term_memories BEGIN INSERT INTO memory_fts(memory_fts, rowid, content, tags, type) VALUES ('delete', OLD.rowid, OLD.content, OLD.tags, OLD.type); END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON long_term_memories BEGIN INSERT INTO memory_fts(memory_fts, rowid, content, tags, type) VALUES ('delete', OLD.rowid, OLD.content, OLD.tags, OLD.type); INSERT INTO memory_fts(rowid, content, tags, type) VALUES (NEW.rowid, NEW.content, NEW.tags, NEW.type); END;`);
    db.exec(`CREATE TABLE IF NOT EXISTS hypotheses (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, hypothesis TEXT NOT NULL, evidence_for INTEGER DEFAULT 0, evidence_against INTEGER DEFAULT 0, confidence REAL DEFAULT 0.5, context TEXT NOT NULL, last_tested TEXT, status TEXT DEFAULT 'active' CHECK(status IN ('active', 'confirmed', 'refuted', 'dormant')));`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON hypotheses(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_hypotheses_confidence ON hypotheses(confidence);`);

    // Migration: add arousal column to existing databases
    try {
        db.exec(`ALTER TABLE long_term_memories ADD COLUMN arousal REAL NOT NULL DEFAULT 0.0`);
        console.log('[MEMORY] Migration: added arousal column');
    } catch {
        // Column already exists — expected on subsequent runs
    }

    // Initialize vector table if extension loaded
    if (vecExtensionLoaded) {
        initializeVectorTable();
    }

    console.log(`[MEMORY] Database initialized: ${dbPath}`);
    return db;
}

/**
 * Initialize the vec0 virtual table for vector search
 */
function initializeVectorTable(): void {
    if (!db || !vecExtensionLoaded) return;

    const dim = getEmbeddingDimension();

    try {
        // Check if table already exists and what its dimension is
        const existingTable = db.prepare("SELECT sql FROM sqlite_master WHERE name='memory_vec'").get() as any;

        if (existingTable) {
            const sql = existingTable.sql;
            const match = sql.match(/float\[(\d+)\]/);
            const existingDim = match ? parseInt(match[1], 10) : null;

            if (existingDim !== dim) {
                console.warn(`[MEMORY] Dimension mismatch detected (stored: ${existingDim}, current: ${dim}). Recreating vector index...`);
                db.exec(`DROP TABLE memory_vec;`);
            }
        }

        // Create vec0 virtual table for vector search
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
                memory_id TEXT PRIMARY KEY,
                embedding float[${dim}]
            );
        `);

        // If we dropped and recreated, we need to populate it from main table
        const count = (db.prepare("SELECT COUNT(*) as count FROM memory_vec").get() as any).count;
        if (count === 0) {
            const memoryCount = (db.prepare("SELECT COUNT(*) as count FROM long_term_memories").get() as any).count;
            if (memoryCount > 0) {
                console.log(`[MEMORY] Populating recreated vector index with ${memoryCount} memories...`);
                rebuildVectorIndex();
            }
        }

        console.log(`[MEMORY] Vector index table initialized (dim: ${dim})`);
    } catch (error: any) {
        console.warn(`[MEMORY] Could not create vector table: ${error.message}`);
        vecExtensionLoaded = false;
    }
}

/**
 * Check if vector search is available
 */
export function isVectorSearchAvailable(): boolean {
    return vecExtensionLoaded;
}

/**
 * Get database instance (initializes if needed)
 */
function getDB(): Database.Database {
    if (!db) {
        return initializeDatabase();
    }
    return db;
}

// ========== Long-term Memory Operations ==========

/**
 * Create a new long-term memory
 */
export function createMemory(memory: Omit<LongTermMemory, 'id' | 'access_count' | 'last_accessed'>): string {
    const db = getDB();
    const id = uuidv4();

    const stmt = db.prepare(`
        INSERT INTO long_term_memories (
            id, created_at, content, embedding, type, importance, arousal,
            access_count, last_accessed, tags, metadata, source, base_decay_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        id,
        memory.created_at,
        memory.content,
        serializeEmbedding(memory.embedding),
        memory.type,
        memory.importance,
        memory.arousal ?? 0,
        0, // access_count starts at 0
        null, // last_accessed
        JSON.stringify(memory.tags),
        JSON.stringify(memory.metadata || {}),
        memory.source,
        memory.base_decay_rate
    );

    // Also insert into vector index if available
    if (vecExtensionLoaded) {
        try {
            const vecStmt = db.prepare(`
                INSERT INTO memory_vec (memory_id, embedding) VALUES (?, ?)
            `);
            // sqlite-vec expects raw float array as JSON
            vecStmt.run(id, JSON.stringify(memory.embedding));
        } catch (error: any) {
            console.warn(`[MEMORY] Could not add to vector index: ${error.message}`);
        }
    }

    return id;
}

/**
 * Get memory by ID
 */
export function getMemory(id: string): LongTermMemory | null {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM long_term_memories WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
        id: row.id,
        created_at: row.created_at,
        content: row.content,
        embedding: deserializeEmbedding(row.embedding),
        type: row.type,
        importance: row.importance,
        arousal: row.arousal ?? 0,
        access_count: row.access_count,
        last_accessed: row.last_accessed,
        tags: JSON.parse(row.tags),
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        source: row.source,
        base_decay_rate: row.base_decay_rate,
    };
}

/**
 * Get all memories (paginated)
 */
export function getAllMemories(limit: number = 100, offset: number = 0): LongTermMemory[] {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM long_term_memories ORDER BY created_at DESC LIMIT ? OFFSET ?');
    const rows = stmt.all(limit, offset) as any[];

    return rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        content: row.content,
        embedding: deserializeEmbedding(row.embedding),
        type: row.type,
        importance: row.importance,
        arousal: row.arousal ?? 0,
        access_count: row.access_count,
        last_accessed: row.last_accessed,
        tags: JSON.parse(row.tags),
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        source: row.source,
        base_decay_rate: row.base_decay_rate,
    }));
}

/**
 * Update memory metadata (merges with existing metadata)
 */
export function updateMemoryMetadata(memoryId: string, metadata: Record<string, any>): void {
    const memory = getMemory(memoryId);
    if (!memory) return;

    const updatedMetadata = { ...memory.metadata, ...metadata };

    const db = getDB();
    const stmt = db.prepare('UPDATE long_term_memories SET metadata = ? WHERE id = ?');
    stmt.run(JSON.stringify(updatedMetadata), memoryId);
}

/**
 * Update memory importance
 */
export function updateMemoryImportance(memoryId: string, importance: number): void {
    const db = getDB();
    const stmt = db.prepare('UPDATE long_term_memories SET importance = ? WHERE id = ?');
    stmt.run(Math.max(0, Math.min(1, importance)), memoryId);
}

/**
 * Decay importance for memories not accessed since a given timestamp.
 * Returns the number of memories decayed.
 */
export function decayUnaccessedMemories(sinceTimestamp: string, decayDelta: number): number {
    const db = getDB();
    // Decay memories that were never accessed or last accessed before the timestamp.
    // Clamp importance to a floor of 0.05 so memories never fully vanish.
    const stmt = db.prepare(`
        UPDATE long_term_memories
        SET importance = MAX(0.05, importance * (1.0 - ?))
        WHERE (last_accessed IS NULL OR last_accessed < ?)
          AND importance > 0.05
    `);
    const result = stmt.run(decayDelta, sinceTimestamp);
    return result.changes;
}

/**
 * Update retrieval statistics when memory is accessed
 */
export function updateRetrievalStats(memoryId: string, accessTime: string): void {
    const db = getDB();
    const stmt = db.prepare(`
        UPDATE long_term_memories
        SET access_count = access_count + 1,
            last_accessed = ?
        WHERE id = ?
    `);

    stmt.run(accessTime, memoryId);
}

/**
 * Get memories by type
 */
export function getMemoriesByType(type: LongTermMemory['type']): LongTermMemory[] {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM long_term_memories WHERE type = ? ORDER BY created_at DESC');
    const rows = stmt.all(type) as any[];

    return rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        content: row.content,
        embedding: deserializeEmbedding(row.embedding),
        type: row.type,
        importance: row.importance,
        arousal: row.arousal ?? 0,
        access_count: row.access_count,
        last_accessed: row.last_accessed,
        tags: JSON.parse(row.tags),
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        source: row.source,
        base_decay_rate: row.base_decay_rate,
    }));
}

/**
 * Delete a memory by ID
 */
export function deleteMemory(memoryId: string): boolean {
    const db = getDB();

    try {
        // Delete from main table
        const stmt = db.prepare('DELETE FROM long_term_memories WHERE id = ?');
        const result = stmt.run(memoryId);

        // Also delete from vector index if available
        if (vecExtensionLoaded) {
            try {
                const vecStmt = db.prepare('DELETE FROM memory_vec WHERE memory_id = ?');
                vecStmt.run(memoryId);
            } catch (e) {
                // Vector delete failed, not critical
            }
        }

        return result.changes > 0;
    } catch (error: any) {
        console.error(`[MEMORY] Failed to delete memory ${memoryId}:`, error.message);
        return false;
    }
}

/**
 * Get total memory count
 */
export function getMemoryCount(): number {
    const db = getDB();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM long_term_memories');
    const row = stmt.get() as any;
    return row?.count || 0;
}

/**
 * Get recent memories (last N)
 */
export function getRecentMemoriesFromDB(limit: number = 10): LongTermMemory[] {
    return getAllMemories(limit, 0);
}

/**
 * BM25 full-text search using FTS5
 * Returns memories ranked by BM25 score (keyword relevance)
 */
export function bm25Search(query: string, limit: number = 10): Array<{ memory: LongTermMemory; bm25Score: number }> {
    const db = getDB();

    // Escape special FTS5 characters and create query
    const escapedQuery = query
        .replace(/['"]/g, '')  // Remove quotes
        .split(/\s+/)          // Split on whitespace
        .filter(t => t.length > 1)  // Remove single chars
        .map(t => `"${t}"`)    // Quote each term for exact match
        .join(' OR ');         // OR for broader matching

    if (!escapedQuery) {
        return [];
    }

    try {
        // FTS5 BM25 search - lower score = better match
        const stmt = db.prepare(`
            SELECT
                ltm.*,
                bm25(memory_fts) as bm25_score
            FROM memory_fts
            JOIN long_term_memories ltm ON memory_fts.rowid = ltm.rowid
            WHERE memory_fts MATCH ?
            ORDER BY bm25(memory_fts)
            LIMIT ?
        `);

        const rows = stmt.all(escapedQuery, limit) as any[];

        return rows.map(row => ({
            memory: {
                id: row.id,
                created_at: row.created_at,
                content: row.content,
                embedding: deserializeEmbedding(row.embedding),
                type: row.type,
                importance: row.importance,
                arousal: row.arousal ?? 0,
                access_count: row.access_count,
                last_accessed: row.last_accessed,
                tags: JSON.parse(row.tags),
                metadata: row.metadata ? JSON.parse(row.metadata) : {},
                source: row.source,
                base_decay_rate: row.base_decay_rate,
            },
            bm25Score: Math.abs(row.bm25_score), // BM25 returns negative scores
        }));
    } catch (error: any) {
        // FTS5 query failed (possibly malformed query)
        console.warn(`[MEMORY] BM25 search failed: ${error.message}`);
        return [];
    }
}

/**
 * Rebuild FTS index (call after bulk imports or if index is out of sync)
 */
export function rebuildFTSIndex(): void {
    const db = getDB();

    // Clear and rebuild FTS
    db.exec(`
        DELETE FROM memory_fts;
        INSERT INTO memory_fts(rowid, content, tags, type)
        SELECT rowid, content, tags, type FROM long_term_memories;
    `);

    console.log('[MEMORY] FTS index rebuilt');
}

/**
 * Vector similarity search using sqlite-vec (O(log n))
 * Returns memory IDs ranked by cosine similarity
 */
export function vectorSearch(queryEmbedding: number[], limit: number = 10): Array<{ memoryId: string; distance: number }> {
    if (!vecExtensionLoaded) {
        return []; // Fallback to brute-force in retrieval.ts
    }

    const db = getDB();

    try {
        // sqlite-vec uses L2 distance by default, we need cosine which is 1 - cosine_similarity
        // vec_distance_cosine returns the cosine distance (0 = identical, 2 = opposite)
        const stmt = db.prepare(`
            SELECT
                memory_id,
                vec_distance_cosine(embedding, ?) as distance
            FROM memory_vec
            ORDER BY distance
            LIMIT ?
        `);

        const rows = stmt.all(JSON.stringify(queryEmbedding), limit) as any[];

        return rows.map(row => ({
            memoryId: row.memory_id,
            distance: row.distance,
        }));
    } catch (error: any) {
        console.warn(`[MEMORY] Vector search failed: ${error.message}`);
        return [];
    }
}

/**
 * Rebuild vector index (call after bulk imports or migration)
 */
export function rebuildVectorIndex(): void {
    if (!vecExtensionLoaded) {
        console.warn('[MEMORY] sqlite-vec not available, cannot rebuild vector index');
        return;
    }

    const db = getDB();

    try {
        // Clear and rebuild vector index
        db.exec(`DELETE FROM memory_vec;`);

        // Get all memories and insert embeddings
        const memories = getAllMemories(100000); // Get all
        const insertStmt = db.prepare(`
            INSERT INTO memory_vec (memory_id, embedding) VALUES (?, ?)
        `);

        for (const memory of memories) {
            insertStmt.run(memory.id, JSON.stringify(memory.embedding));
        }

        console.log(`[MEMORY] Vector index rebuilt with ${memories.length} entries`);
    } catch (error: any) {
        console.error(`[MEMORY] Failed to rebuild vector index: ${error.message}`);
    }
}

// ========== Memory Link Operations ==========

/**
 * Create a link between two memories
 */
export function createLink(link: Omit<MemoryLink, 'id'>): string {
    const db = getDB();
    const id = uuidv4();

    const stmt = db.prepare(`
        INSERT INTO memory_links (
            id, from_memory_id, to_memory_id, weight, link_type,
            created_at, last_updated, co_retrieval_count, initial_similarity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(from_memory_id, to_memory_id) DO UPDATE SET
            last_updated = excluded.last_updated,
            weight = MIN(1.0, memory_links.weight + 0.05),
            co_retrieval_count = memory_links.co_retrieval_count + 1
        RETURNING id
    `);

    const result = stmt.get(
        id,
        link.from_memory_id,
        link.to_memory_id,
        Math.min(1.0, Math.max(0.0, link.weight)), // Ensure bounds
        link.link_type,
        link.created_at,
        link.last_updated,
        link.co_retrieval_count || 0,
        link.initial_similarity || 0.0
    ) as any;

    return result.id;
}

/**
 * Get all outgoing links from a memory
 */
export function getOutgoingLinks(memoryId: string): MemoryLink[] {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM memory_links WHERE from_memory_id = ? ORDER BY weight DESC');
    const rows = stmt.all(memoryId) as any[];

    return rows.map(row => ({
        id: row.id,
        from_memory_id: row.from_memory_id,
        to_memory_id: row.to_memory_id,
        weight: row.weight,
        link_type: row.link_type,
        created_at: row.created_at,
        last_updated: row.last_updated,
        co_retrieval_count: row.co_retrieval_count,
        initial_similarity: row.initial_similarity,
    }));
}

/**
 * Update link weight (called when memories are co-retrieved)
 */
export function updateLinkWeight(linkId: string, newWeight: number, timestamp: string): void {
    const db = getDB();
    const stmt = db.prepare(`
        UPDATE memory_links
        SET weight = ?,
            last_updated = ?,
            co_retrieval_count = co_retrieval_count + 1
        WHERE id = ?
    `);

    stmt.run(newWeight, timestamp, linkId);
}

/**
 * Prune weak links below threshold
 */
export function pruneWeakLinks(threshold: number = 0.1): number {
    const db = getDB();
    const stmt = db.prepare('DELETE FROM memory_links WHERE weight < ?');
    const result = stmt.run(threshold);

    return result.changes;
}

// ========== Short-term Context Operations ==========

/**
 * Load memory into short-term context
 */
export function loadToShortTerm(slot: ShortTermSlot): void {
    const db = getDB();
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO short_term_context (
            memory_id, loaded_at, ttl_seconds, expires_at, retrieval_weight
        ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(slot.memory_id, slot.loaded_at, slot.ttl_seconds, slot.expires_at, slot.retrieval_weight);
}

/**
 * Get all active short-term memories
 */
export function getShortTermContext(): ShortTermSlot[] {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM short_term_context ORDER BY retrieval_weight DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
        memory_id: row.memory_id,
        loaded_at: row.loaded_at,
        ttl_seconds: row.ttl_seconds,
        expires_at: row.expires_at,
        retrieval_weight: row.retrieval_weight,
    }));
}

/**
 * Remove memory from short-term context
 */
export function evictFromShortTerm(memoryId: string): void {
    const db = getDB();
    const stmt = db.prepare('DELETE FROM short_term_context WHERE memory_id = ?');
    stmt.run(memoryId);
}

/**
 * Remove all expired short-term memories
 */
export function evictExpiredMemories(currentTime: string): number {
    const db = getDB();
    const stmt = db.prepare('DELETE FROM short_term_context WHERE expires_at < ?');
    const result = stmt.run(currentTime);

    return result.changes;
}

// ========== Reflection Operations ==========

/**
 * Save a reflection session
 */
export function saveReflection(reflection: Omit<ReflectionOutput, 'id'>): string {
    const db = getDB();
    const id = uuidv4();

    const stmt = db.prepare(`
        INSERT INTO reflections (
            id, reflected_at, trigger, insights, personality_updates, memories_consolidated, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        id,
        reflection.reflected_at,
        reflection.trigger,
        JSON.stringify(reflection.insights),
        JSON.stringify(reflection.personality_updates),
        JSON.stringify(reflection.memories_consolidated),
        reflection.duration_ms
    );

    // Update last_reflection metadata
    updateMetadata('last_reflection', reflection.reflected_at);

    return id;
}

/**
 * Get recent reflections
 */
export function getRecentReflections(limit: number = 5): ReflectionOutput[] {
    const db = getDB();
    const stmt = db.prepare('SELECT * FROM reflections ORDER BY reflected_at DESC LIMIT ?');
    const rows = stmt.all(limit) as any[];

    return rows.map(row => ({
        id: row.id,
        reflected_at: row.reflected_at,
        trigger: row.trigger,
        insights: JSON.parse(row.insights),
        personality_updates: JSON.parse(row.personality_updates),
        memories_consolidated: JSON.parse(row.memories_consolidated),
        duration_ms: row.duration_ms,
    }));
}

// ========== Metadata Operations ==========

/**
 * Update system metadata
 */
export function updateMetadata(key: string, value: string): void {
    const db = getDB();
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO system_metadata (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
    `);

    stmt.run(key, value);
}

/**
 * Get metadata value
 */
export function getMetadata(key: string): string | null {
    const db = getDB();
    const stmt = db.prepare('SELECT value FROM system_metadata WHERE key = ?');
    const row = stmt.get(key) as any;

    return row ? row.value : null;
}

/**
 * Set metadata value (upsert)
 */
export function setMetadata(key: string, value: string): void {
    const db = getDB();
    const stmt = db.prepare(`
        INSERT INTO system_metadata (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
    `);
    stmt.run(key, value);
}

/**
 * Get memory system statistics
 */
export function getMemoryStats(): MemoryStats {
    const db = getDB();

    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM long_term_memories');
    const total = (totalStmt.get() as any).count;

    const episodicStmt = db.prepare("SELECT COUNT(*) as count FROM long_term_memories WHERE type = 'episodic'");
    const episodic = (episodicStmt.get() as any).count;

    const semanticStmt = db.prepare("SELECT COUNT(*) as count FROM long_term_memories WHERE type = 'semantic'");
    const semantic = (semanticStmt.get() as any).count;

    const proceduralStmt = db.prepare("SELECT COUNT(*) as count FROM long_term_memories WHERE type = 'procedural'");
    const procedural = (proceduralStmt.get() as any).count;

    const linksStmt = db.prepare('SELECT COUNT(*) as count, AVG(weight) as avg_weight FROM memory_links');
    const linksRow = linksStmt.get() as any;

    const stmStmt = db.prepare('SELECT COUNT(*) as count FROM short_term_context');
    const stm = (stmStmt.get() as any).count;

    const reflectionsStmt = db.prepare('SELECT COUNT(*) as count FROM reflections');
    const reflections = (reflectionsStmt.get() as any).count;

    const lastReflection = getMetadata('last_reflection');

    return {
        total_memories: total,
        episodic_count: episodic,
        semantic_count: semantic,
        procedural_count: procedural,
        total_links: linksRow.count,
        avg_link_weight: linksRow.avg_weight || 0,
        short_term_active: stm,
        last_reflection: lastReflection,
        total_reflections: reflections,
    };
}

/**
 * Close database connection (call on shutdown)
 */
export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
        console.log('[MEMORY] Database closed');
    }
}

/**
 * Reset the memory database (delete file)
 */
export function resetDatabase(): void {
    closeDatabase();
    const dbPath = getDbPath();
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log('[MEMORY] Database file deleted');
    }
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');

    // Re-initialize
    initializeDatabase();
    console.log('[MEMORY] Database reset complete');
}
