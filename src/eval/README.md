# Evaluation Harness

Controlled ablation experiments for measuring subsystem contributions to agent performance.

## Architecture

```
src/eval/
  evalConfig.ts      — Feature flag singleton + ablation presets
  mockActions.ts     — Deterministic mock environment API (seeded PRNG)
  runner.ts          — Runs N agent cycles, collects per-cycle metrics
  metrics.ts         — Aggregate statistics (mean, median, entropy, etc.)
  retrospective.ts   — Historical analysis of existing outcomes.jsonl
  report.ts          — Paper-ready markdown comparison tables
```

## How It Works

The eval system uses a **feature flag singleton** (`evalConfig.ts`) to selectively disable subsystems during agent cycles. Each subsystem has a 1-2 line guard at its entry point that checks `isDisabled(flag)` — a function that returns `true` only when the master switch is on AND the specific flag is set. In normal operation (`enabled: false`), every guard is a no-op.

A **mock API** (`mockActions.ts`) replaces live environment calls with deterministic responses using a seeded PRNG (mulberry32). The mock is stateful: posts the agent creates appear in subsequent `get_feed` calls with simulated engagement growth (upvotes, replies), so the fitness polling loop works correctly.

## Ablation Presets

| Preset | What it disables |
|--------|-----------------|
| `FULL_SYSTEM` | Nothing (control condition) |
| `NO_MEMORY` | Temporal memory — retrieval returns empty context |
| `NO_AROUSAL` | Arousal estimation — `estimateArousal()` returns 0 |
| `NO_SPREADING` | Spreading activation — graph traversal skipped |
| `NO_DRIVES` | Drive system — `getDrivePrompt()` returns "" |
| `NO_HYPOTHESES` | Hypothesis learning — `processOutcome()` returns early |
| `NO_STAGNATION` | Stagnation detection — no early exit, no warnings |
| `NO_EVOLUTION` | Strategies + policy mutation |
| `BASELINE` | Everything — bare LLM + action loop |

## CLI Commands

```bash
# List all presets with descriptions
npm run dev -- eval presets

# Run 10 mock cycles with full system (control)
npm run dev -- eval run --mock --preset FULL_SYSTEM --cycles 10

# Run 10 mock cycles with memory ablated
npm run dev -- eval run --mock --preset NO_MEMORY --cycles 10

# Run 10 mock cycles with bare LLM baseline
npm run dev -- eval run --mock --preset BASELINE --cycles 10

# Compare all results side-by-side
npm run dev -- eval compare

# Historical analysis of outcomes.jsonl
npm run dev -- eval retro

# Full help
npm run dev -- eval help
```

### `eval run` Options

| Flag | Description | Default |
|------|------------|---------|
| `--preset <name>` | Ablation preset to use | `FULL_SYSTEM` |
| `--cycles <N>` | Number of agent cycles to run | `3` |
| `--mock` | Use deterministic mock API | off (live API) |
| `--seed <N>` | RNG seed for mock API | `42` |

### `eval compare` Options

| Flag | Description | Default |
|------|------------|---------|
| `--dir <path>` | Directory containing result JSONs | `./eval_results/` |

## Output Format

Results are written to `eval_results/` as JSON files named `<label>_<timestamp>.json`.

### Per-Cycle Metrics

Each cycle records:
- **actions**: List of `{ type, fitness_delta, status }`
- **total_fitness_delta**: Sum of all fitness deltas in the cycle
- **action_diversity**: Count of unique action types used
- **stagnant_actions**: Count of zero-delta actions
- **steps_used**: Total actions taken
- **exit_reason**: `"max_steps"`, `"stagnation"`, `"no_action"`, or `"error"`

### Aggregate Metrics

Computed across all cycles in a run:
- **mean/median/std fitness delta**
- **action_entropy**: Shannon entropy of action type distribution (higher = more diverse behavior)
- **stagnation_rate**: Fraction of actions with zero fitness delta
- **productive_action_rate**: Fraction of create_post/comment/upvote actions
- **early_exit_rate**: Fraction of cycles that hit stagnation exit

### Comparison Report

`eval compare` generates a markdown report with:
1. Side-by-side ablation comparison table
2. Action distribution breakdown per condition
3. Per-cycle fitness CSV data (for external plotting)

## Subsystem Guard Points

Each subsystem has a minimal guard that checks the eval config:

| Subsystem | File | Function | When disabled |
|-----------|------|----------|--------------|
| Temporal memory | `temporal/index.ts` | `getMemoryContext()` | Returns `"No memories available."` |
| Temporal memory | `temporal/index.ts` | `retrieveAndLoadContext()` | Returns `[]` |
| Short-term context | `temporal/index.ts` | `retrieveAndLoadContext()` | Skips STM loading; formats memories directly |
| Arousal | `temporal/arousal.ts` | `estimateArousal()` | Returns `0` |
| Spreading activation | `temporal/retrieval.ts` | `retrieve()` | Sets `useSpreadingActivation: false` |
| Consolidation | `temporal/consolidation.ts` | `consolidateMemories()` | Returns empty result |
| Reflection | `temporal/reflection.ts` | `performReflection()` | Returns empty result |
| Drives | `core/drives.ts` | `getDrivePrompt()` | Returns `""` |
| Hypotheses | `temporal/hypotheses.ts` | `processOutcome()` | Returns early |
| Strategies | `core/strategies.ts` | `getActiveStrategy()` | Returns conservative strategy |
| Policy mutation | `core/policyMutation.ts` | `evolvePolicy()` | Returns current policy unchanged |
| Stagnation | `adapters/moltbook/nodes.ts` | Planner stagnation warning | Skips warning |
| Stagnation | `adapters/moltbook/graph.ts` | `routeAfterExecutor()` | Skips early exit |

## Mock API Details

The mock API (`mockActions.ts`) is stateful:

1. **Post tracking**: `create_post` / `create_link_post` store the post with the agent's name
2. **Engagement simulation**: Each `get_feed` call ticks engagement — 40% chance of +1-3 upvotes, 20% chance of +1 reply per post
3. **Feed composition**: Returns 3-4 random posts from other users + up to 2 of the agent's own recent posts
4. **Fitness polling**: Posts include both `score`/`reply_count` and `upvotes`/`comment_count` fields so the executor's polling scanner picks them up
5. **Determinism**: All randomness uses mulberry32 seeded PRNG — same seed = same results
6. **Cycle isolation**: `resetMockState()` clears posts between cycles

## Adding a New Ablation

1. Add a `disable<Subsystem>: boolean` field to `EvalConfig` in `evalConfig.ts`
2. Add it to `DEFAULT_CONFIG` (set to `false`)
3. Create a preset: `export const NO_FOO = preset("no-foo", { disableFoo: true })`
4. Register in `getPreset()` lookup table
5. Add the guard in the subsystem's entry point:
   ```typescript
   import { isDisabled } from '../../../eval/evalConfig.js';
   if (isDisabled('disableFoo')) return <default>;
   ```

## Retrospective Analysis

`eval retro` parses `~/.config/temporal-agent/outcomes.jsonl` (historical action outcomes) and computes:

- **Action distribution** — overall and per 50-action window
- **Fitness trajectory** — cumulative upvotes/replies over time
- **Strategy comparison** — mean upvotes/replies/moderation per strategy
- **Stagnation runs** — consecutive zero-outcome actions (count, max, mean)
- **Topic diversity** — unique topics per window
