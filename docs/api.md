# API Reference

## MemoryStore

```typescript
import { MemoryStore } from 'engram';

const store = new MemoryStore(dbPath: string);
```

Creates or opens a SQLite database at `dbPath`. Initializes the schema in WAL mode with foreign keys enabled.

---

### Working Memory (`store.working`)

Ephemeral key-value storage with TTL. Entries auto-expire and are purged on read.

| Method | Signature | Description |
|---|---|---|
| `set` | `(agentId, key, value, ttlMs) => void` | Store a key-value pair with TTL in milliseconds |
| `get` | `(agentId, key) => WorkingEntry \| null` | Get by key. Returns null if expired or missing. Bumps access count. |
| `delete` | `(agentId, key) => boolean` | Delete a specific key |
| `clear` | `(agentId) => number` | Clear all working memory for an agent. Returns count deleted |
| `list` | `(agentId) => WorkingEntry[]` | List all active (non-expired) entries |

**WorkingEntry:**
```typescript
{
  key: string;
  value: string;
  agentId: string;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessedAt: number;
}
```

---

### Episodic Memory (`store.episodic`)

Searchable records of past interactions and events.

| Method | Signature | Description |
|---|---|---|
| `store` | `(agentId, episode) => Episode` | Store an episode. Auto-generates ID and timestamps |
| `get` | `(id) => Episode \| null` | Get by ID. Bumps access count |
| `search` | `(query, options?) => Episode[]` | Keyword search across who/what/context/outcome fields |
| `delete` | `(id) => boolean` | Delete by ID |

**Search options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `agentId` | `string` | -- | Filter to a specific agent |
| `timeRange` | `{ start, end }` | -- | Filter by timestamp range |
| `limit` | `number` | 50 | Maximum results |
| `visibility` | `SharingVisibility` | -- | Filter by visibility level |

**Episode:**
```typescript
{
  id: string;
  agentId: string;
  who: string;
  what: string;
  context: string;
  outcome: string;
  timestamp: number;
  visibility: "private" | "team" | "public";
  accessCount: number;
  lastAccessedAt: number;
  expiresAt: number | null;
  metadata: Record<string, unknown>;
}
```

---

### Semantic Memory (`store.semantic`)

Long-term storage for learned facts, patterns, and preferences. Each fact has a confidence score.

| Method | Signature | Description |
|---|---|---|
| `store` | `(agentId, fact) => SemanticFact` | Store a fact. Auto-generates ID and timestamps |
| `get` | `(id) => SemanticFact \| null` | Get by ID. Bumps access count |
| `query` | `(topic, options?) => SemanticFact[]` | Query by topic/fact keyword match |
| `update` | `(id, updates) => SemanticFact \| null` | Update fact, confidence, topic, visibility, or metadata |
| `delete` | `(id) => boolean` | Delete by ID |

**Query options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `agentId` | `string` | -- | Filter to a specific agent |
| `minConfidence` | `number` | -- | Minimum confidence threshold |
| `limit` | `number` | 50 | Maximum results |
| `visibility` | `SharingVisibility` | -- | Filter by visibility level |

**SemanticFact:**
```typescript
{
  id: string;
  agentId: string;
  fact: string;
  topic: string;
  confidence: number;        // 0.0 to 1.0
  sourceEpisodeIds: string[];
  visibility: "private" | "team" | "public";
  accessCount: number;
  lastAccessedAt: number;
  lastVerifiedAt: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}
```

---

### Store-Level Methods

| Method | Signature | Description |
|---|---|---|
| `audit` | `(entry) => void` | Write an audit log entry (id and timestamp auto-generated) |
| `stats` | `(agentId?) => MemoryStats` | Get counts and sizes per tier, plus quarantine and audit totals |
| `close` | `() => void` | Close the database connection |

**MemoryStats:**
```typescript
{
  working: { count: number; totalSize: number };
  episodic: { count: number; totalSize: number; avgAge: number };
  semantic: { count: number; totalSize: number; avgConfidence: number };
  quarantined: number;
  auditEntries: number;
}
```

---

## RecallEngine

```typescript
import { RecallEngine } from 'engram';

const engine = new RecallEngine(store, opts?);
```

**Constructor options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `recencyHalfLifeMs` | `number` | 604800000 (7 days) | Half-life for exponential recency decay |

### `engine.recall(query, filters?)`

Searches all specified tiers, scores each candidate, and returns results ranked by composite score within the token budget.

**RecallFilters:**

| Field | Type | Default | Description |
|---|---|---|---|
| `tiers` | `MemoryTier[]` | All three | Which tiers to search |
| `timeRange` | `{ start, end }` | -- | Filter episodic memories by timestamp |
| `agentId` | `string` | -- | Filter to a specific agent |
| `minConfidence` | `number` | -- | Minimum confidence for semantic results |
| `maxResults` | `number` | 20 | Maximum number of results |
| `maxTokens` | `number` | Infinity | Token budget (~4 chars/token) |

**Returns:** `RecallResult`
```typescript
{
  memories: Memory[];
  totalTokens: number;
  query: string;
  filters: RecallFilters;
}
```

### Scoring

Each tier uses a different weight distribution:

| Tier | Relevance | Recency | Confidence | Frequency |
|---|---|---|---|---|
| Working | 0.5 | 0.3 | -- | 0.2 |
| Episodic | 0.4 | 0.35 | -- | 0.25 |
| Semantic | 0.3 | 0.2 | 0.3 | 0.2 |

---

## ForgettingEngine

```typescript
import { ForgettingEngine } from 'engram';

const engine = new ForgettingEngine(store);
```

| Method | Signature | Description |
|---|---|---|
| `execute` | `(policy, agentId?) => ForgettingReport` | Run a single forgetting policy |
| `executeAll` | `(policies[], agentId?) => ForgettingReport[]` | Run multiple policies in sequence |

See [Forgetting Policies](forgetting.md) for detailed policy documentation.

**ForgettingReport:**
```typescript
{
  policy: string;
  deleted: number;
  demoted: number;
  retained: number;
  reasons: ForgettingReason[];
  executedAt: number;
}
```

---

## IntegrityGuard

```typescript
import { IntegrityGuard } from 'engram';

const guard = new IntegrityGuard(store, opts?);
```

| Option | Type | Default | Description |
|---|---|---|---|
| `maxWritesPerWindow` | `number` | 50 | Writes before warning |
| `windowMs` | `number` | 60000 | Rate limit window in ms |

See [Integrity & Quarantine](integrity.md) for detailed documentation.

---

## SharingManager

```typescript
import { SharingManager } from 'engram';

const sharing = new SharingManager(store);
```

See [Sharing & Visibility](sharing.md) for detailed documentation.
