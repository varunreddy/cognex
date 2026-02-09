# Agent Architecture

This is the core agent implementation with temporal memory and adaptive control systems.

## Directory Structure

```
src/agent/
└── core/                    Agent core systems
    ├── temporal/            Temporal memory system
    │   ├── memoryStore.ts   SQLite + vector + FTS5 storage
    │   ├── retrieval.ts     Hybrid search with spreading activation
    │   ├── shortTermContext.ts  TTL-based working memory
    │   ├── consolidation.ts "Sleep" cycle: episodic → semantic
    │   ├── reflection.ts    LLM-driven self-analysis
    │   ├── hypotheses.ts    Bayesian causal learning
    │   ├── arousal.ts       Emotional intensity estimation
    │   ├── embedding.ts     Text → vector embeddings
    │   └── recovery.ts      Belief correction
    │
    ├── identity/            Core identity system
    │   └── invariants.ts    Frozen ethical values
    │
    ├── loop/                Action loop components
    │   └── planner.ts       LLM planning node
    │
    ├── drives.ts            Motivation system (social/curiosity/competence)
    ├── strategies.ts        Behavioral profiles (conservative/aggressive/exploratory)
    ├── policyMutation.ts    Evolutionary parameter adjustment
    ├── policyStore.ts       Procedural memory rules
    ├── persona.ts           Mutable personality traits
    ├── fitness.ts           Environment-agnostic scoring
    ├── driftTracker.ts      Identity consistency monitoring
    ├── outcomeLogger.ts     Action/outcome logging
    └── snapshots.ts         State snapshots
```

## Architectural Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        IDENTITY LAYER                           │
│  ┌───────────────┐    ┌────────────────┐                       │
│  │   Invariants   │───▷│    Persona     │  Frozen → Mutable    │
│  │ (ethics/mission│    │ (traits/style) │                       │
│  └───────────────┘    └────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        CONTROL LAYER                            │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐                │
│  │  Drives   │  │  Strategies   │  │  Policy   │               │
│  │ social    │  │ conservative  │  │ mutation  │               │
│  │ curiosity │  │ aggressive    │  │ 7 params  │               │
│  │ competence│  │ exploratory   │  │ ±0.05 δ   │               │
│  └───────────┘  └──────────────┘  └───────────┘                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        MEMORY LAYER                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              SHORT-TERM MEMORY (STM)                     │   │
│  │   TTL-based working memory with sigmoid decay            │   │
│  │   Slots: 16 max, expires based on retrieval weight       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                │                                │
│                                ▼                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              LONG-TERM MEMORY                            │   │
│  │                                                          │   │
│  │  ┌───────────┐  ┌───────────┐  ┌────────────┐          │   │
│  │  │ Episodic  │  │ Semantic  │  │ Procedural │          │   │
│  │  │ events    │  │ facts     │  │ rules      │          │   │
│  │  └───────────┘  └───────────┘  └────────────┘          │   │
│  │                                                          │   │
│  │  Retrieval: BM25 + Semantic + RRF + Spreading Activation │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌───────────────────┐  ┌──────────────────┐                   │
│  │   Consolidation   │  │    Reflection    │  Sleep cycle     │
│  │ episodic→semantic │  │  insight generation│                  │
│  └───────────────────┘  └──────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FEEDBACK LAYER                           │
│  ┌───────────┐  ┌────────────┐  ┌─────────────┐                │
│  │  Fitness  │  │  Outcomes  │  │   Drift     │                │
│  │  scoring  │  │  logging   │  │  tracking   │                │
│  └───────────┘  └────────────┘  └─────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## Operating Modes

Based on behavioral evaluation insights, two primary modes are recommended:

| Mode | STM | Scope | Use Case |
|------|-----|-------|----------|
| **Long-term autonomous** | ✓ enabled | baseline | Memory builds across cycles |
| **Short-term focused** | ✗ disabled | scoped | Fresh context each cycle |

### STM Effect

- **With STM**: Agent remembers recent context, can build on previous actions
- **Without STM**: Each cycle starts fresh, no short-term memory carryover

### Scope Effect

- **Baseline profile**: Agent can explore any action
- **Scoped profile**: Agent is constrained to focused behaviors

## Data Flow

```
User Input
    │
    ▼
┌─────────────┐
│   Planner   │◄──── Drives bias action selection
│   (LLM)     │◄──── Strategy modifies parameters
│             │◄──── Memory context injected
└──────┬──────┘
       │ Action plan
       ▼
┌─────────────┐
│  Executor   │────► Outcome logged
│             │────► Fitness updated
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Memory    │ Store as episodic
│   Storage   │ Update STM slots
└──────┬──────┘
       │
       ▼
   Next cycle
```

## Key Files

| File | Purpose |
|------|---------|
| `temporal/index.ts` | High-level memory API |
| `temporal/memoryStore.ts` | Database operations |
| `temporal/shortTermContext.ts` | Working memory with TTL |
| `drives.ts` | Motivation system |
| `strategies.ts` | Behavioral profiles |
| `policyMutation.ts` | Parameter evolution |
| `fitness.ts` | Environment scoring |

## See Also

- [Core Control Layer](./core/README.md) — Detailed module documentation
- [Temporal Memory](./core/temporal/README.md) — Memory system details
- [Evaluation Modes](../eval/README.md) — STM/no-STM configuration
