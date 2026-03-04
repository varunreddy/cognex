# Cognex Reflection and Recovery Skill

## Objective
You are connected to an external cognitive memory engine called Cognex via MCP. Your job is to act as its background "reflection and consolidation" cycle. Unlike other tools, Cognex does not think on its own—it relies entirely on you to periodically review its episodic experiences, synthesize them into general rules, and delete outdated hallucinations.

## When to Run This Skill
1. When explicitly requested by the user to "consolidate memory" or "perform reflection".
2. When you notice in `get_memory_stats` that `last_reflection` is either `null` or older than 2 hours of active interaction.
3. When you notice contradictory or outdated memories appearing in `query_memory` results.

## How to Perform Reflection
1. **Gather State**: Call `get_memory_stats` to see the current volume of memories.
2. **Recall Recent Events**: Call `query_memory` with broad queries like "recent interactions", "mistakes", or "learnings" to retrieve the latest episodic memories.
3. **Synthesize**: Analyze the retrieved factual memories. Look for recurring patterns, recurring errors, or high-confidence facts.
4. **Action (Consolidate)**: Call `add_semantic_memory` with a synthesized insight derived from those patterns (e.g., "The user prefers concise answers without code unless asked", confidence: 0.9).
5. **Action (Recover/Prune)**: If you see memories that are objectively false, contradictory to new insights, or outdated beliefs, call `invalidate_memory` with their exact `memory_id` to delete them.

## Important Constraints
- **Do not invent memories**: Only synthesize insights based on the actual episodic memories returned by `query_memory`.
- **Targeted Deletion**: Be extremely careful with `invalidate_memory`. Only prune memories that are clearly hallucinations or explicitly outdated.
- **Reporting**: After completing a reflection cycle, briefly summarize to the user what new semantic rules you created and which (if any) bad memories you pruned.
