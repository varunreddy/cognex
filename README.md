# Cognex

Cognex is an MCP server that gives LLMs persistent memory. It stores episodic and semantic memories with local embeddings (Xenova/all-MiniLM-L6-v2, 384 dimensions), indexes them with sqlite-vec for vector search, and retrieves them via hybrid search (BM25 + cosine similarity + spreading activation).

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd cognex
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Setup

Cognex runs as an MCP server over standard I/O. Add it to your MCP client configuration (Claude Code, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "cognex": {
      "command": "node",
      "args": ["/path/to/cognex/dist/src/mcp/server.js"]
    }
  }
}
```

Data is stored in `~/.config/cognex/temporal_memory.db` (SQLite + sqlite-vec).

## MCP Tools

| Tool | Description |
|------|-------------|
| `query_memory(query, limit)` | Hybrid search: BM25 + vector similarity + spreading activation |
| `store_memory(content)` | Store a new episodic memory |
| `add_semantic_memory(insight, confidence)` | Store an abstracted insight or learned rule |
| `invalidate_memory(memory_id)` | Delete a false or outdated memory |
| `get_memory_stats()` | Return memory counts, link stats, and last reflection timestamp |
| `create_hypothesis(trigger, belief)` | Create a causal hypothesis for Bayesian tracking |
| `update_hypothesis(hypothesis_id, outcome)` | Update a hypothesis with an observed outcome |
| `tune_retrieval_params(params)` | Adjust retrieval parameters (alpha, beta, TTL, link threshold, spread depth) |

## Architecture

- **Embeddings**: Local via Xenova/all-MiniLM-L6-v2 (384 dimensions, no API calls)
- **Storage**: SQLite with sqlite-vec extension for vector indexing
- **Retrieval**: Hybrid search combining BM25 keyword matching, cosine similarity, and reciprocal rank fusion
- **Spreading activation**: Graph-based associative recall through memory links (BFS, 0.7 decay per hop)
- **Short-term memory**: TTL-based working context with rehearsal effects
- **Arousal**: Keyword and emotion-label heuristics modulate retrieval weight and STM persistence

## Reflection & Memory Optimization

Cognex relies on the connected LLM to classify and synthesize memories. See **`reflect_skill.md`** for instructions on periodic reflection and memory consolidation.

## Eval Integration

Subsystems can be selectively disabled for ablation experiments via `src/eval/evalConfig.ts`:

- `disableTemporalMemory` — memory context returns empty
- `disableShortTermContext` — short-term memory bypassed
- `disableArousal` — arousal estimation returns 0
- `disableSpreadingActivation` — graph traversal skipped

## Running Tests

```bash
npm test
```
