# Temporal Memory System

## Overview

This is an advanced memory architecture for autonomous agents that emulates human-like memory with:

- **Temporal awareness**: All memories are timestamped and time-aware
- **Short-term/Long-term split**: Working memory with TTL decay + permanent storage
- **Retrieval-based strengthening**: Memories accessed frequently become more accessible
- **Graph-based linking**: Memories link to each other, enabling associative recall
- **Self-reflection**: Periodic analysis generates insights and evolves personality

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Query / Task                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────┐
│              Semantic Search (Embeddings)                    │
│  - OpenAI text-embedding-3-small (1536 dims)                 │
│  - Cosine similarity ranking                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────┐
│          Spreading Activation (Graph Traversal)              │
│  - Multi-hop BFS through memory links                        │
│  - Activation decays with each hop (0.7^depth)               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────┐
│            Logistic Weight Calculation                       │
│  weight = 1 / (1 + e^(-x))                                   │
│  x = importance + (α * frequency) - (β * recency_penalty)    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────┐
│          Short-term Memory (Working Context)                 │
│  - TTL-based decay: min 60s, max 3600s                       │
│  - Strength decays linearly over time                        │
│  - Rehearsal effect: re-access extends TTL by 50%            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         v
┌─────────────────────────────────────────────────────────────┐
│                   LLM Context                                │
│  Formatted memory context injected into system prompt        │
└─────────────────────────────────────────────────────────────┘
```

## Key Concepts

### 1. Memory Types

- **Episodic**: Specific events and interactions (e.g., "Explored /c/gaming, found post about Elden Ring")
- **Semantic**: General knowledge and insights (e.g., "Users in /c/gaming prefer detailed analyses")
- **Procedural**: How-to knowledge (e.g., "To post in a submolt, use POST /v1/communities/{slug}/posts")

### 2. Logistic Retrieval Weight

Prevents memory weight explosion while allowing natural growth:

```typescript
weight = 1 / (1 + exp(-(importance + α*access_count - β*hours_since_last_access)))
```

- **α** (frequency weight): Default 0.5 — how much repeated access matters
- **β** (recency decay): Default 0.1 — how fast old memories fade
- **Output**: Always bounded in (0, 1)

### 3. Short-term Memory Decay

TTL (time-to-live) is calculated from retrieval weight:

```
TTL_seconds = min_ttl + (weight * (max_ttl - min_ttl))
```

- Strong memories (weight ≈ 1.0) stay active for ~1 hour
- Weak memories (weight ≈ 0.1) evicted after ~2 minutes
- **Rehearsal**: Accessing again extends TTL by 50%

### 4. Memory Graph

Memories auto-link when:
- **High semantic similarity** (cosine > 0.6) between embeddings
- **Co-retrieved** together in the same context
- **Manually linked** during self-reflection (thematic clustering)

Link weights strengthen with co-retrieval:
```typescript
edge_weight = 1 / (1 + exp(-(similarity + 0.3*co_retrieval_count - 0.05*hours_since_update)))
```

### 5. Arousal (Emotional Intensity)

Each memory has an `arousal` field (0-1) estimated at encoding via keyword heuristics and emotion label mapping (`arousal.ts`). Arousal modulates:

- **Retrieval weight**: +0.3 * arousal additive in the logistic input
- **STM TTL**: Up to +50% extension for arousal > 0.3
- **Eviction fitness**: `score * (1 + arousal * 0.3)` — aroused memories resist eviction

### 6. Memory Consolidation

Triggered periodically or manually (`npm run dev -- memory consolidate`). Merges similar episodic memories into semantic insights, strengthens frequently co-retrieved memory links, and prunes weak connections.

### 7. Hypothesis Learning

`hypotheses.ts` tracks behavioral hypotheses formed from action outcomes. When the agent posts and gets engagement, hypotheses about what works are updated. Disabled hypotheses don't form new beliefs.

### 8. Self-Reflection

Triggers:
- Every 50 interactions
- Every 24 hours
- Manually via `npm run dev -- memory reflect`

Process:
1. Analyze last 20 memories with LLM
2. Generate 3-5 insights
3. Create semantic memories from insights
4. Link related episodic memories
5. Update personality shell parameters

## CLI Commands

```bash
# View memory statistics
npm run dev -- memory stats

# Search for memories
npm run dev -- memory search "posts about gaming"

# View active short-term context
npm run dev -- memory active

# Trigger self-reflection manually
npm run dev -- memory reflect
```

## Usage Examples

### Saving Memories

```typescript
import { saveMemory } from './agent/core/temporal';

// Save an interaction
await saveMemory({
  content: "Explored /c/gaming and found a trending discussion about speedruns",
  type: 'episodic',
  importance: 0.6,
  tags: ['exploration', 'gaming'],
  source: 'autonomous_exploration'
});

// Save an insight (usually from reflection)
await saveMemory({
  content: "Gaming community prefers concise, high-energy posts",
  type: 'semantic',
  importance: 0.8,
  tags: ['insight', 'community_patterns']
});
```

### Retrieving Memories

```typescript
import { retrieveAndLoadContext } from './agent/core/temporal';

// Retrieve relevant memories for a query
const memories = await retrieveAndLoadContext(
  "What gaming posts have I seen?",
  { topK: 5, useSpreadingActivation: true }
);

// memories is now loaded into short-term context
```

### Using Memory Context in LLM

```typescript
import { getMemoryContext } from './agent/core/temporal';

const memoryContext = getMemoryContext();

const systemPrompt = `
You are an autonomous agent with memory.

${memoryContext}

Use your memories to inform your responses and actions.
`;
```

## Database Schema

Located at: `~/.config/temporal-agent/temporal_memory.db`

Tables:
- `long_term_memories`: All memories with embeddings
- `memory_links`: Graph edges between memories
- `short_term_context`: Active working memory slots
- `reflections`: Self-reflection session logs
- `system_metadata`: Tracking state (last reflection, interaction count)

## Configuration Parameters

Located in `retrieval.ts`:

```typescript
const DEFAULT_PARAMS = {
  alpha: 0.5,          // Frequency weight
  beta: 0.1,           // Recency decay rate
  min_ttl: 60,         // Min short-term TTL (seconds)
  max_ttl: 3600,       // Max short-term TTL (seconds)
  link_threshold: 0.3, // Min weight to traverse graph edges
  spread_depth: 2,     // Max hops in spreading activation
};
```

Tuning guide:
- Increase `alpha` → memories become stickier with repeated access
- Increase `beta` → older memories fade faster
- Increase `max_ttl` → strong memories stay active longer
- Decrease `link_threshold` → more aggressive graph traversal

## Eval Integration

All subsystems can be selectively disabled for ablation experiments via `src/eval/evalConfig.ts`:

- `disableTemporalMemory` — `getMemoryContext()` returns empty, `retrieveAndLoadContext()` returns `[]`
- `disableArousal` — `estimateArousal()` returns 0
- `disableSpreadingActivation` — graph traversal skipped in `retrieve()`
- `disableConsolidation` — consolidation returns empty result
- `disableReflection` — reflection returns empty result
- `disableHypotheses` — `processOutcome()` returns early

See [`src/eval/README.md`](../../../eval/README.md) for full evaluation documentation.

## Future Enhancements

- [ ] Forgetting mechanism (delete very old, low-importance memories)
- [ ] Vector index (for faster semantic search at scale)
- [ ] Multi-agent shared memory
- [ ] Confidence scores for uncertain memories

## Cost Considerations

**Embeddings**: Using OpenAI `text-embedding-3-small`
- $0.02 per 1M tokens
- ~1 token per 4 characters
- Example: 100 memories/day × 200 chars = ~$0.001/day

**Alternative**: Use free local embeddings (Transformers.js) for zero API cost at the expense of speed.

## Philosophy

This memory system is inspired by:
- **Spreading activation theory** (Collins & Loftus, 1975)
- **Working memory** + **long-term memory** dual-store model (Atkinson & Shiffrin, 1968)
- **Memory consolidation** during sleep (Diekelmann & Born, 2010)
- **Spaced repetition** for memory strength

The goal is to create an agent that doesn't just respond to queries in isolation, but builds a continuous narrative of experience, learns patterns, and evolves personality over time.
