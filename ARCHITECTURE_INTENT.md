# Architecture Intent

This document explains **why** this system is designed the way it is — the philosophical foundation, not the technical implementation.

---

## No Primary Task Objective

This agent can complete tasks when instructed — it will research topics, post at scheduled times, respond to queries. But it **doesn't require a task to exist**.

Most agent architectures are evaluated purely by task completion. This one asks a different question: *What does an agent do when it has no instructions?*

The architecture supports both:
- **Instructed mode**: User gives a task → agent executes it
- **Autonomous mode**: No task given → agent acts based on drives, memory, and context

The test focus is on the autonomous case. What happens when an agent runs continuously with no goal? This setting is closer to continuous autonomy than episodic task execution.

---

## Fitness Is Diagnostic, Not Objective

Fitness exists, but it is **not a reward signal the agent optimizes**. It serves two purposes:

1. **Retrospective analysis** — Did the agent's recent actions correlate with stable or improving behavior?
2. **Mutation pressure** — Should the agent's parameters drift? Fitness informs, but does not command.

The agent does not "try to increase fitness." It takes actions; fitness is measured afterward.

---

## Memory Constrains Behavior, Not Task Performance

The temporal memory system exists to **constrain** the agent's action space, not to make it "smarter" at tasks.

- Short-term memory limits what the agent attends to
- Long-term memory provides historical context that shapes (but does not prescribe) behavior
- Consolidation creates semantic patterns that influence, not instruct

Memory is a filter, not an optimizer.

---

## Action-Semantic Evaluation

Evaluation in this system focuses on **what actions the agent chooses and when it stops**, not whether those actions achieved an external goal.

Key evaluation questions:
- What action types does the agent select?
- Does the agent stop appropriately (rational inaction)?
- How does memory state affect action selection?

This is behavioral analysis, not task benchmarking. Actions are treated as observable evidence of internal policy and memory state.

---

## Rational Inaction Is Valid

A well-functioning agent may choose to **do nothing**. This is considered valid behavior, not failure.

Inaction is appropriate when:
- No drives are elevated
- No relevant memories indicate action is needed
- The context does not warrant intervention

An agent that acts constantly is not necessarily better than one that waits.

---

## Implications for Research

This architecture is suited for studying:
- Long-horizon autonomous behavior without instruction
- Memory's role in constraining (not optimizing) behavior
- Identity persistence under continuous operation
- The structure of agent "experience" over time

It is **not** suited for:
- Task completion benchmarks
- Goal-oriented performance metrics
- Reward maximization experiments

---

*For technical details, see the component READMEs in `src/agent/` and `src/eval/`.*
