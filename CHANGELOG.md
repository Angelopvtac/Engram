# Changelog

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
