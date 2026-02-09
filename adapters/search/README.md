# Search Adapter (Tavily)

Optional web search adapter using the [Tavily API](https://tavily.com/) for external knowledge acquisition. Provides three capabilities that feed into the temporal memory system:

- **Search** — Quick web lookup, LLM-synthesized into actionable knowledge
- **Research** — Deep AI-synthesized reports with citations for building domain expertise
- **Extract** — Rich content extraction from discovered URLs

## Architecture

```
Agent Action Loop
    │
    ├── searchSkill.ts     Agent-facing search interface
    │       │
    │   searchAgent.ts     LLM synthesis + memory integration
    │       │
    │   searchTool.ts      Caching layer (in-memory, config TTL)
    │       │
    │   tavily.ts          Tavily Search HTTP API
    │
    ├── research.ts        Deep research → high-importance semantic memories
    │       │
    │   Tavily Research API (mini ~30s / pro ~60-120s)
    │
    ├── extract.ts         URL content extraction → episodic memories
    │       │
    │   Tavily Extract API (basic / advanced JS-rendered)
    │
    └── searchConfig.ts    Configuration and interactive setup
```

## Setup

```bash
npm run dev -- search setup
```

Or set the environment variable directly:

```bash
export TAVILY_API_KEY=your-key-here
```

Get a key from [tavily.com](https://tavily.com/) (1,000 free monthly credits, no card required).

## Capabilities

### Search

Quick web lookup with LLM synthesis. Results are stored as semantic memories (importance: 0.7).

```typescript
import { executeSearchSkill } from "./searchSkill.js";

const result = await executeSearchSkill({
    query: "latest developments in memory-augmented agents",
    reason: "need current research context",
    depth: "thorough", // "quick" (5 results) or "thorough" (10 results)
});
```

### Research

Deep AI-synthesized reports with citations. Stored as high-importance semantic memories (importance: 0.9) — these are the agent's primary tool for building domain expertise over time.

```typescript
import { conductResearch } from "./research.js";

const report = await conductResearch({
    topic: "comparison of memory architectures in autonomous agents",
    depth: "thorough",        // "quick" (~30s mini) or "thorough" (~60-120s pro)
    citation_format: "numbered",
});
```

The research endpoint returns AI-synthesized reports rather than raw search results, making it ideal for complex questions, comparisons, and comprehensive analysis.

### Extract

Rich content extraction from specific URLs. Stored as episodic memories (importance: 0.6) linked to the query context.

```typescript
import { extractContent, extractSingle } from "./extract.js";

// Extract with relevance filtering
const extracted = await extractContent({
    urls: ["https://arxiv.org/abs/...", "https://blog.example.com/..."],
    query: "temporal memory consolidation",  // reranks by relevance
    chunksPerSource: 3,                      // only relevant excerpts
    extractDepth: "advanced",                // handles JS-rendered pages
});

// Quick single-URL extraction
const page = await extractSingle("https://example.com/article", "memory architecture");
```

## Integration with Temporal Memory

All three capabilities store results in the temporal memory system:

| Capability | Memory type | Importance | Tags |
|-----------|-------------|------------|------|
| Search | semantic | 0.7 | `search`, `external_knowledge` |
| Research | semantic | 0.9 | `research`, `deep_knowledge` |
| Extract | episodic | 0.6 | `extracted`, `web_content` |

This means:
- Results are retrievable via hybrid BM25 + semantic retrieval with spreading activation
- Research builds up as high-priority semantic knowledge that consolidation preserves
- Extracted content decays naturally but strengthens when re-accessed
- The agent recalls previously acquired information without re-querying

## Configuration

Persisted to `~/.config/temporal-agent/search-agent.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| `tavily_enabled` | `false` | Whether search is active |
| `max_results_per_search` | `5` | Results per search API call |
| `search_depth` | `"basic"` | `"basic"` or `"advanced"` |
| `use_cache` | `true` | In-memory result caching |
| `cache_ttl_minutes` | `30` | Cache expiry |
| `max_searches_per_run` | `5` | Rate limit per agent run |
| `save_to_memory` | `true` | Store results in temporal memory |
| `memory_importance` | `0.7` | Base importance for search memories |

## API Reference

Based on the [Tavily API skills](https://github.com/tavily-ai/skills):

- **Search**: `POST https://api.tavily.com/search` — max 400 char query, 1-20 results, depth levels from ultra-fast to advanced
- **Research**: `POST https://api.tavily.com/research` — mini (~30s) or pro (~60-120s) models, structured output schemas
- **Extract**: `POST https://api.tavily.com/extract` — up to 20 URLs, basic or advanced (JS) extraction, markdown or text
