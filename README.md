# Engram

Production agent memory infrastructure with 3-tier memory, selective recall, and policy-driven forgetting. Backed by SQLite via better-sqlite3. TypeScript, ESM, strict mode.

## Features

- **3-tier memory model** -- working (ephemeral key-value with TTL), episodic (past interactions and events), semantic (learned facts and patterns)
- **RecallEngine** -- keyword search across all tiers with relevance/recency/confidence/frequency scoring and token budget constraints
- **ForgettingEngine** -- 5 policy types: time-based, confidence-based, access-based, explicit, and GDPR right-to-erasure
- **IntegrityGuard** -- write rate limiting, contradiction detection, quarantine with release workflow
- **SharingManager** -- cross-agent memory sharing with private/team/public visibility controls
- **Full audit logging** -- every store, delete, demote, share, revoke, and quarantine action is logged
- **CLI** -- `engram init`, `store`, `recall`, `forget`, `stats` commands

## Install

```
npm install engram
```

## Quick Start -- Library API

```typescript
import { MemoryStore, RecallEngine, ForgettingEngine } from 'engram';

const store = new MemoryStore('.engram/memory.db');

// Working memory -- ephemeral key-value with TTL
store.working.set('agent-1', 'current-task', 'reviewing PR #42', 300_000);
const entry = store.working.get('agent-1', 'current-task');

// Episodic memory -- record a past interaction
const episode = store.episodic.store('agent-1', {
  who: 'user',
  what: 'Asked about deployment status',
  context: 'slack channel',
  outcome: 'Provided ETA',
  timestamp: Date.now(),
  visibility: 'private',
  expiresAt: null,
  metadata: {}
});

// Semantic memory -- store a learned fact
const fact = store.semantic.store('agent-1', {
  fact: 'Production deploys happen on Tuesdays',
  topic: 'deployment',
  confidence: 0.9,
  sourceEpisodeIds: [episode.id],
  visibility: 'private',
  metadata: {}
});

// Recall -- search across all tiers
const engine = new RecallEngine(store);
const results = engine.recall('deployment', { agentId: 'agent-1' });

// Forgetting -- run a cleanup policy
const forgetter = new ForgettingEngine(store);
forgetter.execute({
  name: 'cleanup',
  type: 'access_based',
  inactiveDays: 30
}, 'agent-1');

store.close();
```

## API Reference

### MemoryStore

```typescript
new MemoryStore(dbPath: string)
```

Creates or opens a SQLite database at `dbPath`. Initializes schema in WAL mode with foreign keys enabled.

**Working memory** (`.working`):

| Method | Signature | Description |
|---|---|---|
| `set` | `(agentId, key, value, ttlMs) => void` | Store a key-value pair with TTL in milliseconds |
| `get` | `(agentId, key) => WorkingEntry \| null` | Get by key. Returns null if expired or missing |
| `delete` | `(agentId, key) => boolean` | Delete a specific key |
| `clear` | `(agentId) => number` | Clear all working memory for an agent. Returns count deleted |
| `list` | `(agentId) => WorkingEntry[]` | List all active (non-expired) entries |

**Episodic memory** (`.episodic`):

| Method | Signature | Description |
|---|---|---|
| `store` | `(agentId, episode) => Episode` | Store an episode. Auto-generates ID and timestamps |
| `get` | `(id) => Episode \| null` | Get by ID. Increments access count |
| `search` | `(query, options?) => Episode[]` | Keyword search across who/what/context/outcome |
| `delete` | `(id) => boolean` | Delete by ID |

Search options: `agentId`, `timeRange: { start, end }`, `limit` (default 50), `visibility`.

**Semantic memory** (`.semantic`):

| Method | Signature | Description |
|---|---|---|
| `store` | `(agentId, fact) => SemanticFact` | Store a fact. Auto-generates ID and timestamps |
| `get` | `(id) => SemanticFact \| null` | Get by ID. Increments access count |
| `query` | `(topic, options?) => SemanticFact[]` | Query by topic/fact keyword match |
| `update` | `(id, updates) => SemanticFact \| null` | Update fact, confidence, topic, visibility, or metadata |
| `delete` | `(id) => boolean` | Delete by ID |

Query options: `agentId`, `minConfidence`, `limit` (default 50), `visibility`.

**Store-level methods**:

| Method | Signature | Description |
|---|---|---|
| `audit` | `(entry) => void` | Write an audit log entry (id and timestamp auto-generated) |
| `stats` | `(agentId?) => MemoryStats` | Get counts and sizes per tier, plus quarantine and audit totals |
| `close` | `() => void` | Close the database connection |

### RecallEngine

```typescript
new RecallEngine(store: MemoryStore, opts?: { recencyHalfLifeMs?: number })
```

Default recency half-life: 7 days. Memories decay exponentially -- a memory accessed 7 days ago scores 0.5 for recency.

```typescript
engine.recall(query: string, filters?: RecallFilters): RecallResult
```

Searches all specified tiers, scores each candidate on relevance, recency, confidence, and frequency, then returns results ranked by composite score within the token budget.

**RecallFilters**:

| Field | Type | Default | Description |
|---|---|---|---|
| `tiers` | `MemoryTier[]` | All three | Which tiers to search |
| `timeRange` | `{ start, end }` | -- | Filter episodic memories by timestamp range |
| `agentId` | `string` | -- | Filter to a specific agent |
| `minConfidence` | `number` | -- | Minimum confidence for semantic results |
| `maxResults` | `number` | 20 | Maximum number of results |
| `maxTokens` | `number` | Infinity | Token budget (estimated at ~4 chars/token) |

**RecallResult**: `{ memories: Memory[], totalTokens: number, query: string, filters: RecallFilters }`

### ForgettingEngine

```typescript
new ForgettingEngine(store: MemoryStore)
```

| Method | Signature | Description |
|---|---|---|
| `execute` | `(policy, agentId?) => ForgettingReport` | Run a single forgetting policy |
| `executeAll` | `(policies[], agentId?) => ForgettingReport[]` | Run multiple policies in sequence |

**Policy types**:

| Type | Key Fields | Behavior |
|---|---|---|
| `time_based` | `ttl: { working?, episodic?, semantic? }` | Delete memories older than their tier's TTL (in ms) |
| `confidence_based` | `confidenceThreshold` (default 0.3) | Below threshold: demote semantic to episodic. Below half threshold: delete |
| `access_based` | `inactiveDays` (default 30) | Delete inactive episodic memories. Demote inactive semantic to episodic |
| `explicit` | `target` | Delete all episodic/semantic memories matching target string |
| `gdpr` | `target` | Same as explicit, plus purges working memory and quarantine entries |

**ForgettingReport**: `{ policy, deleted, demoted, retained, reasons: ForgettingReason[], executedAt }`

### IntegrityGuard

```typescript
new IntegrityGuard(store: MemoryStore, opts?: {
  maxWritesPerWindow?: number,  // default 50
  windowMs?: number             // default 60000 (1 minute)
})
```

| Method | Signature | Description |
|---|---|---|
| `validate` | `(memory: Memory) => IntegrityResult` | Validate a memory write. Quarantines if blocked |
| `getQuarantined` | `(agentId?) => QuarantinedEntry[]` | List quarantined memories |
| `releaseFromQuarantine` | `(quarantineId) => boolean` | Release (approve) a quarantined memory |

**IntegrityResult**: `{ valid: boolean, warnings: string[], blockedReason: string | null }`

Checks performed:
- **Write rate limiting** -- warns above `maxWritesPerWindow`, blocks above 2x that threshold
- **Contradiction detection** -- flags semantic facts with high word overlap but differing content (especially negation)
- **Content validation** -- warns on empty or excessively large (>100K char) episodic content

### SharingManager

```typescript
new SharingManager(store: MemoryStore)
```

| Method | Signature | Description |
|---|---|---|
| `configure` | `(config: SharingConfig) => void` | Set agent sharing defaults (team ID, default visibility per tier) |
| `getConfig` | `(agentId) => SharingConfig \| null` | Get agent's sharing config |
| `share` | `(memoryId, tier, visibility) => boolean` | Set visibility. Returns false for working memory (always private) |
| `revoke` | `(memoryId, tier) => boolean` | Set back to private |
| `getTeamMemories` | `(teamId) => { episodic, semantic }` | Get team/public-visible memories for all agents in a team |
| `getPublicMemories` | `() => { episodic, semantic }` | Get all public-visibility memories across all agents |

Working memory cannot be shared -- `share()` returns `false` for the working tier.

## CLI

Global options: `--db <path>` (default `.engram/memory.db`), `--agent <id>` (default `default`).

```bash
# Initialize a memory store
engram init --agent my-agent --team my-team

# Store memories
engram store working "current task" --key task --ttl 300000
engram store episodic "User asked about billing" --who user --context chat
engram store semantic "Billing issues peak on Mondays" --topic billing --confidence 0.85

# Recall
engram recall "billing" --tiers episodic,semantic --max-results 5

# Forget
engram forget --policy time_based --ttl-working 300000 --ttl-episodic 604800000
engram forget --policy gdpr --target "user@example.com"

# Stats
engram stats
```

### CLI Commands

**`engram init`** -- Initialize a memory store. Use `--team <id>` to associate the agent with a team.

**`engram store <tier> <content>`** -- Store a memory. Tier is `working`, `episodic`, or `semantic`.
- Working: `--key <key>` (auto-generated if omitted), `--ttl <ms>` (default 300000)
- Episodic: `--who <who>` (default "system"), `--context <ctx>`, `--outcome <outcome>`, `--visibility <v>`
- Semantic: `--topic <topic>` (default "general"), `--confidence <n>` (default 1.0), `--visibility <v>`

**`engram recall <query>`** -- Search memories.
- `--tiers <tiers>` -- comma-separated (default: all three)
- `--max-results <n>` (default 10), `--max-tokens <n>`, `--min-confidence <n>`

**`engram forget`** -- Run a forgetting policy via `--policy <type>`.
- `--ttl-working <ms>`, `--ttl-episodic <ms>`, `--ttl-semantic <ms>` (time_based)
- `--confidence-threshold <n>` (confidence_based, default 0.3)
- `--inactive-days <n>` (access_based, default 30)
- `--target <entity>` (explicit, gdpr)

**`engram stats`** -- Show memory counts, sizes, and averages per tier.

## Architecture

```
┌─────────────────────────────────────────┐
│              CLI / Library API           │
├─────────┬──────────┬──────────┬─────────┤
│ Recall  │ Forget   │Integrity │ Sharing │
│ Engine  │ Engine   │  Guard   │ Manager │
├─────────┴──────────┴──────────┴─────────┤
│            MemoryStore                   │
│  ┌─────────┬──────────┬──────────┐      │
│  │ Working │ Episodic │ Semantic │      │
│  │  (TTL)  │ (events) │ (facts)  │      │
│  └─────────┴──────────┴──────────┘      │
├─────────────────────────────────────────┤
│           SQLite (WAL mode)             │
└─────────────────────────────────────────┘
```

All state lives in a single SQLite file. Tables: `working_memory`, `episodic_memory`, `semantic_memory`, `quarantine`, `audit_log`, `sharing_config`. Full indexing on agent ID, timestamps, visibility, topic, and confidence.

## Development

```bash
npm run build      # Compile TypeScript
npm run dev        # Watch mode
npm run lint       # Type-check without emit
npm test           # Run tests (vitest)
npm run test:watch # Watch mode tests
```

## License

MIT
