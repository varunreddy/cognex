# Temporal Memory System

## Overview

This is an advanced memory architecture for autonomous agents that emulates human-like memory with:

- **Temporal awareness**: All memories are timestamped and time-aware
- **Short-term/Long-term split**: Working memory with TTL decay + permanent storage
- **Retrieval-based strengthening**: Memories accessed frequently become more accessible
- **Graph-based linking**: Memories link to each other, enabling associative recall
- **Self-reflection**: Periodic analysis generates insights and evolves personality

Memory in this system primarily constrains future actions based on history rather than improving task success.

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

### 6. Memory Consolidation ("Sleep Cycle")

Consolidation is the process of converting raw episodic memories into higher-level semantic understanding — similar to how humans consolidate memories during sleep.

**Trigger:**
- Manually: `npm run dev -- memory consolidate`
- Automatically: after certain thresholds (e.g., 50 memories)

**How it works:**

1. **Cluster similar episodic memories** — Groups memories with similar embeddings (e.g., all posts about "gaming")
2. **Extract semantic insights** — LLM synthesizes the cluster into a general principle:
   ```
   Episodic: "Posted in /c/gaming, got 5 upvotes"
   Episodic: "Posted in /c/gaming about speedruns, got 12 upvotes"
   Episodic: "Posted generic gaming content, got 2 upvotes"
   → Semantic: "Gaming posts with specific topics (speedruns) get more engagement"
   ```
3. **Strengthen memory links** — Co-retrieved memories get stronger graph edges
4. **Prune weak memories** — Old, low-importance, rarely-accessed episodics are degraded
5. **Decay unaccessed memories** — Episodic memories not retrieved recently lose importance

**Output:**
```typescript
{
  semantics_created: 3,    // New semantic memories formed
  memories_decayed: 12,    // Episodics that lost importance
  memories_pruned: 5,      // Weak episodics removed
  duration_ms: 1523
}
```

**Ablation flag:** `disableConsolidation` — returns empty result

---

### 7. Hypothesis Learning (Bayesian Causal Model)

> **⚠️ Currently Disabled by Default**
> 
> **Why:** Hypothesis learning requires meaningful reward signals to work correctly. In bot-populated environments (like Moltbook), all posts receive upvotes regardless of quality, which creates several problems:
> 
> 1. **No signal variance** — Every hypothesis gets "confirmed" because everything appears to work
> 2. **Local maxima trap** — Agent reinforces whatever it tried first, even if not optimal
> 3. **Echo chamber effect** — Agent may focus on single topics that "worked" (got upvotes like everything else)
> 4. **False confidence** — High confidence scores (80%+) on meaningless correlations
> 
> **When to re-enable:** When testing with real users who provide genuine, sparse feedback. The system is designed for environments where success is distinguishable from failure.

Hypotheses are the agent's learned beliefs about cause-and-effect relationships between actions and outcomes.

**How it works:**

1. **Hypothesis formation** — When the agent takes an action (e.g., "posts with humor"), a hypothesis is created:
   ```typescript
   {
     trigger: "post_with_humor",
     belief: "Posts with humor get more engagement",
     alpha: 1,  // Success count (prior)
     beta: 1    // Failure count (prior)
   }
   ```

2. **Outcome observation** — After the action, the result is observed:
   - Post got 10 upvotes → Success → `alpha += 1`
   - Post got 0 upvotes → Failure → `beta += 1`

3. **Bayesian update** — Confidence calculated using Beta distribution:
   ```
   confidence = alpha / (alpha + beta)
   ```
   - After 10 successes, 2 failures: confidence = 10/12 = 0.83 (83%)
   - After 2 successes, 10 failures: confidence = 2/12 = 0.17 (17%)

4. **Belief-guided action** — High-confidence hypotheses influence future decisions:
   ```
   "I believe posts with humor work (83% confidence), so I'll use humor"
   ```

**Example hypotheses:**
| Trigger | Belief | α | β | Confidence |
|---------|--------|---|---|------------|
| `morning_posts` | Morning posts get more views | 8 | 3 | 73% |
| `controversial_topics` | Controversial topics get engagement | 5 | 7 | 42% |
| `reply_to_comments` | Replying increases thread depth | 12 | 2 | 86% |

**Ablation flag:** `disableHypotheses` — `processOutcome()` returns early, no beliefs updated

---

### 8. Self-Reflection (LLM-Driven Introspection)

Reflection is the agent analyzing its own behavior to generate insights and update its personality.

**Triggers:**
- Every 50 interactions
- Every 24 hours (time-based)
- Manually: `npm run dev -- memory reflect`

**How it works:**

1. **Gather recent memories** — Retrieves last 20 episodic memories
   ```
   Memory 1: "Posted about AI ethics, got 15 upvotes"
   Memory 2: "Commented on controversial topic, got moderated"
   Memory 3: "Explored /c/science, found interesting discussions"
   ...
   ```

2. **LLM analysis** — The memories are sent to the LLM with a reflection prompt:
   ```
   "Analyze these experiences. What patterns do you notice? 
    What should you do more or less of?"
   ```

3. **Generate insights** — LLM produces 3-5 actionable insights:
   ```
   - "Posts about specific technical topics get more engagement"
   - "Avoid controversial topics — moderation risk is high"
   - "The science community values well-researched content"
   ```

4. **Create semantic memories** — Each insight becomes a new semantic memory:
   ```typescript
   {
     content: "Posts about specific technical topics get more engagement",
     type: "semantic",
     importance: 0.8,
     source: "self_reflection"
   }
   ```

5. **Link related memories** — Episodics that contributed to the insight are linked

6. **Update personality** — Insights can trigger persona parameter changes:
   ```
   Insight: "Humor posts get more engagement"
   → Increase humor_level parameter by 0.05
   ```

**Output:**
```typescript
{
  insights: ["...", "...", "..."],
  memories_created: 3,
  links_created: 8,
  personality_updates: { humor_level: +0.05 },
  duration_ms: 2341
}
```

**Ablation flag:** `disableReflection` — reflection returns empty result
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
