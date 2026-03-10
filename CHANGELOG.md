# Changelog

## 0.2.0 — 2026-03-10

### Features

- **Vector/semantic search**: pluggable `EmbeddingProvider` interface with OpenAI (`text-embedding-3-small`) and local TF-IDF providers. `RecallEngine.recallAsync()` uses cosine similarity when embeddings are available, with keyword fallback.
- **MCP server**: 8 tools (`engram_store`, `engram_recall`, `engram_forget`, `engram_stats`, `engram_share`, `engram_working_get/set/list`) via stdio transport. Compatible with Claude Code and other MCP clients.
- **REST API**: Fastify server with 11 endpoints, OpenAPI/Swagger docs at `/docs`, bearer token authentication (`ENGRAM_API_KEY`), input validation with length limits, graceful shutdown.
- **Python SDK**: `engram-sdk` package with sync (`EngramClient`) and async (`AsyncEngramClient`) clients, Pydantic v2 models, URL-safe path encoding.

### Security

- REST API binds to `127.0.0.1` by default (not `0.0.0.0`)
- Bearer token authentication on all endpoints (except health and docs)
- Input length validation on all string fields (100KB content, 1KB short fields)
- SQL injection prevention via allowlist validation on schema migrations
- URL-safe encoding for path parameters in Python SDK

### Tests

- 71 new tests (embeddings: 30, MCP: 14, REST API: 21, schema migration: 6)
- Total: 131 tests passing

## 0.1.0 — 2026-02-23

Initial release.

### Features

- **3-tier memory model**: working (ephemeral key-value with TTL), episodic (past interactions), semantic (learned facts)
- **RecallEngine**: keyword-based search across all tiers with recency/relevance/confidence scoring and token budget constraints
- **ForgettingEngine**: 5 policy types — time-based, confidence-based, access-based, explicit, and GDPR right-to-erasure
- **IntegrityGuard**: write rate limiting, contradiction detection, quarantine with release workflow
- **SharingManager**: cross-agent memory sharing with private/team/public visibility controls
- **CLI**: `engram init`, `store`, `recall`, `forget`, `stats` commands
- **SQLite backing**: WAL mode, full schema with indexes, audit logging
