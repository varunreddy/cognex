# Action Loop

This is where the agent decides what to do and then does it. The loop has three main stages:

```
   Planner        →     Scope Selector     →     Executor
(what should I do?)   (narrow down options)    (do the thing)
```

## Files

### planner.ts

The brain. Takes the current context (memories, drives, persona) and asks the LLM to decide what action to take.

**Inputs:**
- Current task/prompt
- Retrieved memories (short-term + long-term)
- Drive states (what needs are urgent)
- Persona description
- Available actions

**Output:**
- Structured action plan (JSON)

The planner uses a structured format to get reliable action outputs:
```typescript
{
  thinking: "My reasoning about what to do...",
  action: {
    type: "create_post",
    parameters: { ... }
  }
}
```

### scopeSelector.ts

Optional filtering step that narrows down what the agent can do based on context.

When `useScopeSelector = true`:
- Looks at the task being asked
- Picks the most relevant action category
- Constrains the planner to that category

This prevents the agent from going off on tangents. For example:
- Task: "Post something interesting" → scope = `create_post`
- Task: "Engage with the community" → scope = `comment` or `upvote`

### executor.ts

Takes the action plan from the planner and actually executes it against the environment (API calls, etc).

**Responsibilities:**
- Validate the action format
- Call the appropriate adapter function
- Handle errors and retries
- Log the outcome for fitness tracking

### decider.ts

Helper that determines if we should continue the loop or stop:
- Max steps reached?
- Task completed?
- Agent explicitly said "done"?
- Error occurred?

### types.ts

Shared types for the action loop:
- `ActionPlan` — what the planner outputs
- `ActionResult` — what the executor returns
- `LoopState` — current state of the action loop

## How They Work Together

```
1. Task comes in: "Post something interesting"
                        ↓
2. Planner retrieves memories, checks drives
                        ↓
3. Scope selector (if enabled) narrows to "create_post"
                        ↓
4. Planner asks LLM for action plan
                        ↓
5. Executor runs the action
                        ↓
6. Decider checks: continue or stop?
                        ↓
7. If continue → back to step 2 with updated state
```

## Configuration

The loop behavior is controlled by options passed to `runMoltbookAgent`:

```typescript
const result = await runMoltbookAgent("Do something", {
  mode: "loop",         // single action or loop until done
  maxSteps: 10,         // max iterations before forced stop
  useScopeSelector: true // enable scope filtering
});
```
