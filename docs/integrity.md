# Integrity & Quarantine

The `IntegrityGuard` validates memory writes before they enter the store. It catches anomalous patterns -- sudden write bursts, contradictory facts, or malformed content -- and quarantines blocked memories for human review.

## Setup

```typescript
import { IntegrityGuard } from 'engram';

const guard = new IntegrityGuard(store, {
  maxWritesPerWindow: 50,  // default: 50 writes
  windowMs: 60_000         // default: 1 minute
});
```

## Validation

Call `validate()` before writing a memory. It returns whether the write is safe, along with any warnings.

```typescript
const result = guard.validate({
  tier: 'semantic',
  data: fact
});

if (result.valid) {
  // Safe to write
} else {
  // Memory was quarantined
  console.log(result.blockedReason);
}

// Check warnings even on valid writes
for (const warning of result.warnings) {
  console.log(warning);
}
```

**IntegrityResult:**
```typescript
{
  valid: boolean;           // true if the write is allowed
  warnings: string[];       // non-blocking issues
  blockedReason: string | null;  // if blocked, why
}
```

## Checks

### Write Rate Limiting

Tracks writes per agent within a sliding time window.

| Condition | Result |
|---|---|
| Below `maxWritesPerWindow` | Pass |
| Above threshold but below 2x | Warning (elevated rate) |
| Above 2x threshold | **Blocked** and quarantined |

This catches potential memory poisoning attacks where a compromised agent floods the store.

### Contradiction Detection

For semantic memory writes, the guard checks existing facts on the same topic for contradictions:

1. Finds facts with the same topic
2. Compares word overlap between new and existing facts
3. If overlap is >50% and the facts differ, checks for negation patterns
4. If overlap is >70% or negation is detected, flags as a potential contradiction

**Example:**
- Existing: "Production deploys happen on Tuesdays"
- New: "Production deploys do not happen on Tuesdays"
- Result: Warning -- potential contradiction detected

This is a heuristic check. Contradictions produce warnings, not blocks, so the agent or operator can decide.

### Content Validation

For episodic memory writes:

| Condition | Result |
|---|---|
| Empty content | Warning |
| Content > 100,000 characters | Warning |

## Quarantine

When a write is blocked, the memory is moved to the quarantine table with:
- The full serialized memory data
- The reason it was blocked
- A timestamp
- The agent ID

### Viewing Quarantined Memories

```typescript
// All quarantined memories
const all = guard.getQuarantined();

// Filtered by agent
const agentQ = guard.getQuarantined('agent-1');
```

Each entry includes:
```typescript
{
  id: string;           // quarantine entry ID
  memoryId: string;     // original memory ID
  tier: MemoryTier;
  data: string;         // JSON-serialized memory
  reason: string;       // why it was quarantined
  quarantinedAt: number;
}
```

### Releasing from Quarantine

After reviewing a quarantined memory, release it to remove it from quarantine:

```typescript
guard.releaseFromQuarantine(quarantineId); // => true
```

Note: releasing removes the quarantine entry. You'll need to re-store the memory through normal channels if you want it in the store.

## Audit Trail

Every quarantine action is recorded in the audit log with action `"quarantine"`, the memory ID, tier, agent, and the block reason.
