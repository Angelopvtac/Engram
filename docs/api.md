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
| `embeddingProvider` | `EmbeddingProvider` | `undefined` | Embedding provider for vector search |

### `engine.recall(query, filters?)`

Synchronous keyword-based search. Searches all specified tiers, scores each candidate, and returns results ranked by composite score within the token budget.

### `engine.recallAsync(query, filters?)`

Async version that uses vector similarity when an `embeddingProvider` is configured. Falls back to keyword matching when no provider is available. **Recommended for REST API and MCP integrations.**

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

## EmbeddingProvider

```typescript
import { createEmbeddingProvider, type EmbeddingProvider } from 'engram';
```

Pluggable interface for vector embeddings used by RecallEngine.

### Interface

```typescript
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}
```

### Factory

```typescript
const provider = createEmbeddingProvider({
  provider: "openai",      // or "local"
  apiKey: "sk-...",        // optional, falls back to OPENAI_API_KEY env var
  model: "text-embedding-3-small",  // optional
  localDimensions: 128,    // optional, for local provider
});
```

### Providers

| Provider | Class | Dimensions | Dependencies |
|---|---|---|---|
| OpenAI | `OpenAIEmbeddingProvider` | 1536 | `OPENAI_API_KEY` |
| Local | `LocalEmbeddingProvider` | 128 (configurable) | None |

The local provider uses TF-IDF-style character n-gram hashing. It produces deterministic embeddings suitable for testing and offline operation, but quality is lower than neural embeddings.

### Utility Functions

```typescript
import { cosineSimilarity, serializeEmbedding, deserializeEmbedding } from 'engram';

// Compare two vectors (returns -1 to 1)
const score = cosineSimilarity(vecA, vecB);

// Store/retrieve embeddings from SQLite BLOBs
const blob = serializeEmbedding(vec);
const vec = deserializeEmbedding(blob);
```

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

---

## REST API

The REST API exposes all Engram operations over HTTP via Fastify. Start it with:

```bash
engram-api --db ~/.engram/memory.db --port 3847
```

Or programmatically:

```typescript
import { createApiServer } from 'engram';

const app = await createApiServer({ dbPath: './memory.db', apiKey: 'secret' });
await app.listen({ port: 3847, host: '127.0.0.1' });
```

### Authentication

Set `ENGRAM_API_KEY` env var or pass `--api-key` flag. When set, all endpoints except `/api/v1/health` and `/docs` require a `Authorization: Bearer <key>` header.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check (no auth required) |
| `POST` | `/api/v1/store` | Store a memory (working, episodic, or semantic) |
| `POST` | `/api/v1/recall` | Recall memories by natural language query |
| `POST` | `/api/v1/forget` | Run a forgetting policy |
| `GET` | `/api/v1/stats` | Get memory statistics |
| `POST` | `/api/v1/share` | Share a memory |
| `POST` | `/api/v1/revoke` | Revoke sharing on a memory |
| `GET` | `/api/v1/working/:agentId` | List working memory entries |
| `GET` | `/api/v1/working/:agentId/:key` | Get a working memory entry |
| `PUT` | `/api/v1/working/:agentId/:key` | Set a working memory entry |
| `DELETE` | `/api/v1/working/:agentId/:key` | Delete a working memory entry |

### Store (`POST /api/v1/store`)

```json
{
  "tier": "episodic",
  "agentId": "agent-1",
  "who": "user",
  "what": "Asked about deployment",
  "context": "slack",
  "outcome": "Provided ETA"
}
```

### Recall (`POST /api/v1/recall`)

```json
{
  "query": "deployment schedule",
  "agentId": "agent-1",
  "tiers": ["episodic", "semantic"],
  "maxResults": 10,
  "maxTokens": 2000
}
```

### OpenAPI Docs

Interactive Swagger documentation is available at `http://localhost:3847/docs` when the server is running.

---

## MCP Server

The MCP server exposes Engram operations as MCP tools via stdio transport, compatible with Claude Code and other MCP clients.

```bash
engram-mcp --db ~/.engram/memory.db
```

### Configuration

Add to your MCP client config (e.g., Claude Code's `mcp_servers.json`):

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram-mcp",
      "args": ["--db", "~/.engram/memory.db"]
    }
  }
}
```

Environment variable `ENGRAM_DB_PATH` can be used instead of `--db`.

### Tools

| Tool | Description |
|---|---|
| `engram_store` | Store a memory (working, episodic, or semantic) |
| `engram_recall` | Recall memories by natural language query |
| `engram_forget` | Run a forgetting policy |
| `engram_stats` | Get memory statistics |
| `engram_share` | Share a memory |
| `engram_working_get` | Get a working memory entry |
| `engram_working_set` | Set a working memory entry |
| `engram_working_list` | List working memory entries |

---

## Python SDK

See the [Python SDK README](../python/README.md) for full documentation.

```python
from engram import EngramClient, AsyncEngramClient

# Sync
client = EngramClient(base_url="http://localhost:3847")
client.store(tier="episodic", agent_id="agent-1", what="something happened")
results = client.recall("what happened")

# Async
async with AsyncEngramClient() as client:
    results = await client.recall("what happened")
```

The Python SDK wraps the REST API. Start the REST API server before using the SDK.
