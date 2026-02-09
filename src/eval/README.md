# Evaluation Modes (Simplified)

Behavioral evaluation for temporal-agent-control.

## Evaluation Philosophy

These evaluation modes are behavioral, not goal-oriented. The agent is not optimizing a task objective; evaluation focuses on what actions are chosen and when the agent stops acting. For architectural intent, see [`ARCHITECTURE_INTENT.md`](../../ARCHITECTURE_INTENT.md) at the repository root.

## STM Modes

| Preset | Description | Use Case |
|--------|-------------|----------|
| `full` | STM enabled | Long-term autonomous, memory builds across cycles |
| `no-stm` | STM disabled | Short-term focused, fresh each cycle |

## Profiles

| Profile | Description |
|---------|-------------|
| `baseline` | No scope constraints — agent chooses any action |
| `scoped` | Uses scope selector for focused, goal-directed behavior |

## What is Scope?

**Scope** constrains what the agent can do during an evaluation cycle. Instead of a vague "do something meaningful" prompt, scope provides **concrete, goal-directed tasks**.

### Without Scope (baseline)
```
Prompt: "[EVAL] Autonomous action cycle — do something meaningful."
Result: Agent may browse, post, comment, search, or do nothing productive
```

### With Scope (scoped profile)
```
Prompt: "[EVAL] Task: Write and publish an original post. Allowed actions: create_post."
Result: Agent is focused on a specific productive action
```

### Available Scopes

| Scope | Task | Expected Actions |
|-------|------|------------------|
| `post` | Write and publish an original post | `create_post` |
| `engage` | Find a post and comment/upvote | `create_comment`, `upvote_post` |
| `link` | Search and share a link post | `web_search`, `create_link_post` |
| `explore` | Discover a community and participate | `list_submolts`, `get_feed`, `create_comment` |
| `mixed` | Do something productive (agent chooses) | Any productive action |
| `round-robin` | Rotate through all scopes per cycle | Varies |

### Why Scope Matters

- **Without scope**: Agent often browses without creating content
- **With scope**: Agent completes concrete tasks, enabling behavioral comparison
- **Key insight**: Behavioral metrics (what agent does) matter more than action metrics (how many steps)

## Recommended Combinations

| Mode | STM | Profile | Use Case |
|------|-----|---------|----------|
| Long-term autonomous | `full` | `baseline` | Memory builds up, agent explores freely |
| Short-term focused | `no-stm` | `scoped` | Fresh context, directed tasks |

## CLI Commands

```bash
# List presets
npm run dev -- eval presets

# Long-term autonomous (STM + no scope)
npm run dev -- eval run --preset full --cycles 5 --mock --profile baseline

# Short-term focused (no-STM + scoped)
npm run dev -- eval run --preset no-stm --cycles 5 --mock --profile scoped

# Specific scope
npm run dev -- eval run --preset no-stm --profile scoped --scope post

# Round-robin through all scopes
npm run dev -- eval run --preset full --profile scoped --scope round-robin
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--preset full\|no-stm` | STM mode | `full` |
| `--cycles N` | Number of cycles | `3` |
| `--mock` | Use mock API | off |
| `--mode independent\|cumulative` | Reset behavior | `independent` |
| `--profile baseline\|scoped` | Scope constraints | `baseline` |
| `--scope <name>` | Specific scope (when scoped) | `round-robin` |
| `--max-steps N` | Max steps per cycle | `10` |

## Files

```
src/eval/
  evalConfig.ts  — STM mode configuration (full, no-stm)
  runner.ts      — Cycle runner with scope/profile support
  taskScopes.ts  — Task scope definitions (post, engage, link, etc.)
  mockActions.ts — Deterministic mock environment API
```
