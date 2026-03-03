# Cognex

Cognex is an abstract cognitive memory module designed to operate seamlessly via the Model Context Protocol (MCP). It provides persistent episodic and semantic memory storage, autonomous motivation states (drives/fitness), and vectorized local embeddings.

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd Cognex
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

Cognex is designed to run as an MCP server. Your client (e.g., Claude Code, Claude Desktop) can connect to it securely over standard I/O.

Add Cognex to your MCP Client's configuration (using your actual absolute path to `server.js`):

```json
{
  "mcpServers": {
    "cognex": {
      "command": "node",
      "args": ["/path/to/Cognex/dist/src/mcp/server.js"]
    }
  }
}
```

*Note: Persistent data is stored securely in `~/.config/cognex/` on your host machine.*

## Exposed MCP Tools

When connected, Cognex exposes the following API tools for the LLM to interact with:

- **`store_memory(content)`**: Write new episodic experiences.
- **`query_memory(query, limit)`**: Search the knowledge graph (BM25 + Semantic Search).
- **`add_semantic_memory(insight, confidence)`**: Save abstracted rules or learnings.
- **`invalidate_memory(memory_id)`**: Prune false beliefs or hallucinations.
- **`get_memory_stats()`**: Monitor memory volume and check the timestamp of `last_reflection`.
- **`report_task_outcome(action, success_score)`**: Update the agent's internal fitness loop.
- **`get_drive_state()`**: Query current urgency levels for exploration, social interaction, or competence.

## Reflection & Memory Optimization
Cognex relies entirely on the external LLM to classify and synthesize memories. Please review the provided **`reflect_skill.md`** file for explicit instructions on how to use Claude to reflect periodically and keep Cognex's database optimized.
