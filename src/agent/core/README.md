# Adaptive Control Layer

The control layer governs agent behavior through an evolutionary loop: **Act → Measure → Mutate → Select → Repeat**. Each subsystem is independently toggleable via the [evaluation framework](../../eval/README.md) for ablation experiments.

## Architecture

```
                    ┌──────────────┐
                    │   Identity   │  Frozen core values (ethics, mission)
                    │  invariants  │  Blocks incompatible mutations
                    └──────┬───────┘
                           │ validates
                    ┌──────▼───────┐
                    │   Persona    │  Mutable traits, interests, style
                    │              │  Evolves from fitness signals
                    └──────┬───────┘
                           │ constrains
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼───────┐ ┌─────▼──────┐ ┌───────▼──────┐
   │   Strategies  │ │   Policy   │ │    Drives    │
   │  conservative │ │  mutation  │ │  social      │
   │  aggressive   │ │  7 params  │ │  curiosity   │
   │  exploratory  │ │  ±0.05 δ   │ │  competence  │
   └──────┬───────┘ └─────┬──────┘ └───────┬──────┘
          │ selects        │ tunes          │ biases
          └────────┬───────┘                │
                   │                        │
            ┌──────▼───────┐         ┌──────▼───────┐
            │    Action     │ ◄──────│  Drive-based  │
            │   Selection   │        │   priority    │
            └──────┬───────┘         └──────────────┘
                   │
            ┌──────▼───────┐
            │   Execution   │
            └──────┬───────┘
                   │
     ┌─────────────┼─────────────┐
     │             │             │
┌────▼────┐ ┌─────▼─────┐ ┌────▼─────┐
│ Fitness │ │  Outcome  │ │  Drift   │
│ scoring │ │  logging  │ │ tracking │
└────┬────┘ └───────────┘ └────┬─────┘
     │                         │
     └──────────┬──────────────┘
                │ feeds back
         ┌──────▼───────┐
         │  Next cycle   │
         │  (selection   │
         │   pressure)   │
         └──────────────┘
```

## Modules

### Drives (`drives.ts`)

Three motivational needs that decay over time:

| Drive | Satisfied by | Decay rate |
|-------|-------------|------------|
| **Social** | Comments, replies, follows | ~2 units/hour |
| **Curiosity** | Searches, browsing, exploration | ~1.5 units/hour |
| **Competence** | Successful posts, skill use | ~1 unit/hour |

Each drive ranges 0–100. The most urgent drive (lowest satisfaction) biases action selection. Drive state is injected into the LLM prompt as qualitative descriptions ("desperately lacking", "somewhat satisfied", etc.).

**Ablation flag:** `disableDrives` — `getDrivePrompt()` returns empty string.

### Strategies (`strategies.ts`)

Three competing behavioral profiles with weighted selection:

| Strategy | Characteristics |
|----------|----------------|
| **Conservative** | Low risk (×0.3), mild tone (×0.9), low exploration (×0.5) |
| **Aggressive** | High risk (×1.8), intense tone (×1.5), high frequency (×1.3) |
| **Exploratory** | Max exploration (×2.0), high humor (×1.5), moderate risk (×1.2) |

Strategies rotate every N actions. Weights evolve via natural selection: strategies that produce higher fitness get higher selection probability. Each strategy applies multipliers to the base policy parameters.

**Ablation flag:** `disableStrategies` — returns conservative strategy with default weights.

### Policy Mutation (`policyMutation.ts`)

Seven mutable behavioral parameters, each in [0, 1]:

| Parameter | Controls |
|-----------|----------|
| `tone` | Formal (0) ↔ Casual (1) |
| `risk_tolerance` | Safe topics (0) ↔ Controversial (1) |
| `exploration_rate` | Familiar patterns (0) ↔ Novel approaches (1) |
| `post_frequency` | Rare posting (0) ↔ Frequent (1) |
| `intensity` | Mild engagement (0) ↔ Strong opinions (1) |
| `verbosity` | Terse (0) ↔ Detailed (1) |
| `humor_level` | Serious (0) ↔ Playful (1) |

Mutations are small (±0.05 per step), triggered by fitness changes. When fitness improves, the parameter that changed most continues in that direction. When fitness drops, parameters shift back. Each mutation is logged with generation number, before/after fitness, and delta values.

**Ablation flag:** `disablePolicyMutation` — `evolvePolicy()` returns current policy unchanged.

### Fitness (`fitness.ts`)

Environment-agnostic scoring with idempotent delta tracking:

```
overall_fitness = (engagement × 0.5 + diversity × 0.3 + novelty × 0.2) × (1 - moderation_penalty)
```

- **Engagement score** (0–100): Upvotes, reply rate, thread depth
- **Diversity score** (0–100): Unique topics, channels, agents interacted with
- **Novelty score** (0–1): How unique the agent's ideas are
- **Moderation penalty**: Up to 50% reduction from moderation events

Post-level idempotency: tracks per-post stats to compute deltas (new upvotes since last check), preventing double-counting on repeated API polls.

### Identity (`identity/`)

Two-tier identity system:

- **Frozen core** (`invariants.ts`): Loaded from `identity.yaml`. Defines immutable values (honesty, respect, curiosity), ethics (no manipulation, no impersonation, transparency), and mission. Every persona mutation is validated against these invariants — violations are blocked with a reason.
- **Mutable shell** (`persona.ts`): Traits, interests, communication style that evolve from fitness signals. High humor engagement → increase humor trait. Moderation events → decrease risk-taking. Policy tone synced to communication style.

### Drift Tracker (`driftTracker.ts`)

Monitors behavioral consistency over time:

- **Policy snapshots**: Records tone/risk/intensity at each analysis window (last 100 kept)
- **Phase detection**: Identifies transitions (aggressive_phase, cautious_phase, polarized_phase) via threshold crossing on policy parameters
- **Polarization index**: Distance from center (0.5) across parameters — high values indicate extreme behavioral profiles
- **Contradiction detection**: Tracks stated positions per topic, flags reversals with decreasing consistency score

### Policy Store (`policyStore.ts`)

Procedural memory for learned behavioral rules:

- Rules have trigger conditions ("When creating comments...") and actions ("...always use a polite tone")
- Created by the reflection system when insights imply actionable rules
- Confidence-gated: rules below 0.95 confidence enter a 24-hour probation period
- Deduplicated on rule text; formatted for LLM prompt injection

### Outcome Logger (`outcomeLogger.ts`)

Append-only JSONL log of raw action outcomes (neutral, non-judgmental):

- Records: action type, timestamp, topic, strategy, policy params, engagement metrics
- Queryable by strategy for performance comparison
- Aggregate stats: count, avg replies/upvotes, moderation rate per strategy
- Used by strategies and drift tracker for analysis

### Snapshots (`snapshots.ts`)

Full-state snapshots for replay and rollback:

- Captures: fitness, policy, strategies, drift, persona — all in one JSON
- Triggered periodically (every 50 actions) or manually
- Keeps last 100 snapshots with metadata index
- Supports restoration (overwrites all state files) and comparison (shows deltas)

### LLM Configuration (`llmConfig.ts`, `llmFactory.ts`)

Pluggable LLM backend with interactive setup:

- Supports: OpenAI, Anthropic, Groq, Fireworks, Together AI, custom OpenAI-compatible endpoints
- Factory creates appropriate client (ChatOpenAI or ChatAnthropic)
- Invocation with exponential backoff retry (3 attempts: 2s, 4s, 8s)
- Strips `<think>` tags from reasoning model responses

## Data Persistence

All state files live in `~/.config/temporal-agent/`:

| File | Format | Module |
|------|--------|--------|
| `drives.json` | JSON | drives |
| `strategies.json` | JSON | strategies |
| `policy.json` | JSON | policyMutation |
| `mutations.jsonl` | JSONL (append) | policyMutation |
| `policies.json` | JSON | policyStore |
| `fitness.json` | JSON | fitness |
| `drift.json` | JSON | driftTracker |
| `outcomes.jsonl` | JSONL (append) | outcomeLogger |
| `persona.md` | Markdown | persona |
| `llm-config.json` | JSON | llmConfig |
| `snapshots/` | JSON files | snapshots |
