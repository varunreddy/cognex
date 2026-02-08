# Temporal Control-State Architecture

This repository implements a temporal control-state architecture for long-running autonomous agents. It provides a biologically-inspired memory system with time-aware decay, consolidation, and retrieval mechanisms, coupled with an adaptive control layer that governs agent behavior through drives, strategies, and evolutionary policy mutation.

## Architecture Overview

```
src/agent/core/
  temporal/              Temporal memory system (episodic/semantic/procedural)
    memoryTypes.ts         Type definitions for all memory structures
    schema.sql             SQLite + sqlite-vec + FTS5 schema
    arousal.ts             Keyword-based emotional intensity estimation
    embedding.ts           Text -> vector embeddings (Xenova/transformers)
    memoryStore.ts         CRUD operations, vector search, FTS5 search
    retrieval.ts           Hybrid BM25 + semantic search with RRF + spreading activation
    shortTermContext.ts    TTL-based working memory with sigmoid decay
    consolidation.ts       "Sleep" cycle: episodic -> semantic compression
    reflection.ts          LLM-driven self-analysis and insight generation
    hypotheses.ts          Bayesian Beta-Binomial causal learning
    recovery.ts            Belief correction from contradictory evidence

  drives.ts              Need system (social/curiosity/competence) with time-based decay
  strategies.ts          Strategy rotation (conservative/aggressive/exploratory)
  policyMutation.ts      Evolutionary parameter changes with fitness gradient
  policyStore.ts         Procedural memory: trigger->rule policy store
  driftTracker.ts        Identity drift detection (phase, polarization, contradictions)
  fitness.ts             Environment-agnostic fitness scoring
  persona.ts             Persona management and mutation
  identity/              Core identity invariants and validation
  outcomeLogger.ts       Raw action/outcome logging
  snapshots.ts           State snapshots for replay and comparison
  llmConfig.ts           LLM provider configuration
  llmFactory.ts          LLM instance factory (OpenAI-compatible)
  timeUtils.ts           Time utilities

src/eval/                Evaluation and ablation framework
  evalConfig.ts          Feature flag singleton + ablation presets
  mockActions.ts         Deterministic mock API (seeded PRNG)
  runner.ts              Runs N agent cycles, collects per-cycle metrics
  metrics.ts             Aggregate statistics (mean, median, entropy)
  report.ts              Paper-ready markdown comparison tables
  retrospective.ts       Historical outcome analysis

adapters/                Optional environment adapters (quarantined)
  moltbook/              Social platform adapter (LangGraph state machine)
  telegram/              Telegram bot interface
  search/                Web search via Tavily (LLM synthesis + memory integration)
```

## Core Contributions

### Temporal Memory System

A three-tier memory architecture (episodic/semantic/procedural) backed by SQLite with sqlite-vec for vector similarity and FTS5 for full-text search.

**Retrieval** combines BM25 lexical scores with cosine similarity via Reciprocal Rank Fusion (RRF), then applies spreading activation across a memory link graph. Retrieved memories are injected into the agent's context window with recency and importance weighting.

**Short-term context** maintains a bounded working memory with TTL-based eviction. Each slot's effective strength follows a sigmoid decay curve, enabling graceful degradation rather than hard cutoffs.

**Consolidation** runs a periodic "sleep" cycle that compresses clusters of episodic memories into higher-level semantic memories, with promotion gating that requires minimum evidential support before generalization.

**Arousal estimation** scores incoming content on emotional intensity using keyword matching across categories (crisis, achievement, conflict, etc.), influencing memory importance and retrieval priority.

### Adaptive Control Layer

**Drives**: Three motivational needs (social, curiosity, competence) that decay over time and are partially satisfied by agent actions. The highest-urgency drive biases action selection.

**Strategies**: Weighted rotation between conservative, aggressive, and exploratory behavioral profiles. Strategy selection probability adapts based on recent fitness outcomes.

**Policy mutation**: Evolutionary parameter adjustment where the agent's behavioral parameters (temperature, risk tolerance, verbosity) mutate probabilistically, with selection pressure from a fitness gradient.

**Identity drift tracking**: Monitors semantic consistency over time, detecting phase transitions, measuring polarization index, and flagging contradictions between current and historical behavior.

**Hypothesis learning**: Bayesian Beta-Binomial model for causal understanding. The agent forms hypotheses about action-outcome relationships and updates beliefs from observed evidence.

## Evaluation Framework

The eval system supports controlled ablation experiments via feature flags. Each subsystem has a guard at its entry point that checks `isDisabled(flag)` -- in normal operation, every guard is a no-op.

### Ablation Presets

| Preset | Disabled subsystems |
|--------|-------------------|
| `FULL_SYSTEM` | None (control condition) |
| `NO_MEMORY` | Temporal memory retrieval |
| `NO_STM` | Short-term context (keeps semantic retrieval, removes TTL decay/eviction) |
| `NO_AROUSAL` | Arousal estimation |
| `NO_SPREADING` | Spreading activation in retrieval |
| `NO_CONSOLIDATION` | Memory consolidation |
| `NO_DRIVES` | Drive system |
| `NO_STRATEGIES` | Strategy rotation |
| `NO_POLICY_MUTATION` | Policy evolution |
| `NO_HYPOTHESES` | Hypothesis learning |
| `MINIMAL_BASELINE` | All subsystems disabled |

The mock API provides deterministic, stateful responses using a seeded PRNG, enabling reproducible experiments where posts the agent creates appear in subsequent feed calls with simulated engagement.

## Data Storage

All persistent state is stored in `~/.config/temporal-agent/`:

| File | Purpose |
|------|---------|
| `llm-config.json` | LLM provider settings |
| `temporal_memory.db` | SQLite database (memories, links, STM, reflections) |
| `fitness.json` | Fitness scores and engagement stats |
| `outcomes.jsonl` | Raw interaction history for evolution |
| `identity.yaml` | Core personality invariants |
| `policy.json` | Evolved policy parameters |
| `hypotheses.json` | Learned behavioral hypotheses |
| `drives.json` | Internal drive states |
| `drift.json` | Identity drift tracking |
| `snapshots/` | State snapshots for replay |

## Setup

```bash
npm install
```

Configure an OpenAI-compatible LLM provider:

```bash
npx tsx src/agent/core/llmConfig.ts
```

## License

Research use.
