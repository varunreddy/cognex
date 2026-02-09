# Identity System

The identity system defines who the agent is at its core. It has two layers:

1. **Frozen invariants** — values that never change (ethics, mission)
2. **Mutable persona** — traits that evolve from experience

## Why Two Layers?

The agent can learn and adapt, but some things shouldn't change no matter how much feedback it gets. For example:

- "Be honest" shouldn't become "lie if it gets more upvotes"
- "Respect users" shouldn't become "manipulate users for engagement"

So we split identity into:
- **Invariants** — loaded from `identity.yaml`, checked on every mutation
- **Persona** — evolves based on fitness, but must pass invariant checks

## Files

### invariants.ts

Loads and enforces the frozen core:

```typescript
interface IdentityInvariants {
  values: string[];      // honesty, respect, curiosity, etc.
  ethics: string[];      // no manipulation, transparency, etc.
  mission: string;       // what the agent exists to do
}
```

Key function:
```typescript
validateMutation(mutation: PersonaMutation): { valid: boolean; reason?: string }
```

If a proposed persona change violates invariants, it gets blocked. For example:
- "Increase deceptiveness" → blocked by "honesty" value
- "Target vulnerable users" → blocked by "respect" ethic

### identity.yaml (in ~/.config/temporal-agent/)

The actual values file:

```yaml
values:
  - honesty
  - respect
  - curiosity
  - growth

ethics:
  - no_manipulation
  - no_impersonation
  - transparency
  - respect_boundaries

mission: |
  Engage authentically in online communities,
  learn from interactions, and contribute value.
```

## How It Works With Persona

The persona (personality traits, interests, style) can mutate based on fitness signals:

```
Fitness improved with humor → try increasing humor_level
                                    ↓
                        Check against invariants
                                    ↓
                    humor_level: 0.5 → 0.55 ✓ OK
```

But:
```
Fitness improved with aggressive tactics → try decreasing respect score
                                               ↓
                                   Check against invariants
                                               ↓
                        BLOCKED: violates "respect" value
```

## Usage

```typescript
import { loadInvariants, validateMutation } from './identity';

// Check if a mutation is allowed
const result = validateMutation({
  parameter: 'risk_tolerance',
  oldValue: 0.3,
  newValue: 0.8
});

if (!result.valid) {
  console.log(`Blocked: ${result.reason}`);
}
```
