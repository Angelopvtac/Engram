# Forgetting Policies

Engram's `ForgettingEngine` supports five policy types for managing memory lifecycle. Policies can be run on-demand, on a schedule, or chained together with `executeAll`.

```typescript
import { ForgettingEngine } from 'engram';

const forgetter = new ForgettingEngine(store);
const report = forgetter.execute(policy, agentId?);
```

Every policy returns a `ForgettingReport` with counts of deleted, demoted, and retained memories plus detailed per-memory reasons.

---

## Time-Based

Delete memories older than a configurable TTL per tier.

```typescript
forgetter.execute({
  name: 'daily-cleanup',
  type: 'time_based',
  ttl: {
    working: 300_000,       // 5 minutes
    episodic: 604_800_000,  // 7 days
    semantic: 7_776_000_000 // 90 days
  }
});
```

Each tier's TTL is independent. Omit a tier to skip it. Compares `created_at` (working, semantic) or `timestamp` (episodic) against the cutoff.

---

## Confidence-Based

Targets semantic memory only. Facts below the threshold are demoted to episodic; facts below half the threshold are deleted outright.

```typescript
forgetter.execute({
  name: 'quality-check',
  type: 'confidence_based',
  confidenceThreshold: 0.3  // default
});
```

| Confidence | Action |
|---|---|
| Below `threshold / 2` (0.15) | Deleted |
| Below `threshold` (0.3) | Demoted to episodic memory |
| At or above `threshold` | Retained |

Demoted facts become episodic entries with the original fact text, topic, and confidence preserved in context and metadata.

---

## Access-Based

Delete or demote memories that haven't been accessed in N days.

```typescript
forgetter.execute({
  name: 'stale-cleanup',
  type: 'access_based',
  inactiveDays: 30  // default
});
```

| Tier | Action |
|---|---|
| Episodic | Deleted if `last_accessed_at` is older than cutoff |
| Semantic | Demoted to episodic if `last_accessed_at` is older than cutoff |

Working memory is not affected (it has its own TTL expiry).

---

## Explicit

Delete all episodic and semantic memories matching a target string. The target is matched against content fields using LIKE queries (with proper wildcard escaping).

```typescript
forgetter.execute({
  name: 'forget-project',
  type: 'explicit',
  target: 'project-alpha'
});
```

**Matched fields:**
- Episodic: `who`, `what`, `context`, `outcome`
- Semantic: `fact`, `topic`

Every deletion is individually audit-logged.

---

## GDPR (Right to Erasure)

The most thorough policy. Performs everything `explicit` does, plus:

1. Purges matching working memory entries
2. Deletes matching quarantine entries
3. Scrubs audit log entries containing the target (PII removal)
4. Writes an anonymized completion entry (hashed identifier, no PII)

```typescript
forgetter.execute({
  name: 'gdpr-erasure',
  type: 'gdpr',
  target: 'user@example.com'
});
```

After GDPR erasure, no trace of the target string remains in any table, including the audit log. The only record is an anonymized entry: `gdpr:<sha256-hash-prefix>` with reason `"GDPR right-to-erasure completed"`.

---

## Running Multiple Policies

```typescript
const reports = forgetter.executeAll([
  { name: 'time-cleanup', type: 'time_based', ttl: { episodic: 604_800_000 } },
  { name: 'quality-check', type: 'confidence_based', confidenceThreshold: 0.3 },
  { name: 'stale-cleanup', type: 'access_based', inactiveDays: 30 },
], 'agent-1');
```

Policies run in sequence. Each gets a separate `ForgettingReport`.
