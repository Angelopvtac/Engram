# CLI Reference

## Global Options

| Flag | Default | Description |
|---|---|---|
| `--db <path>` | `$XDG_DATA_HOME/engram/memory.db` or `~/.engram/memory.db` | Path to SQLite database |
| `--agent <id>` | `default` | Agent ID for all operations |

---

## Commands

### `engram init`

Initialize a memory store and optionally associate the agent with a team.

```bash
engram init --agent my-agent
engram init --agent my-agent --team my-team
```

| Flag | Description |
|---|---|
| `--team <id>` | Team ID to associate with (enables cross-agent sharing) |

---

### `engram store <tier> <content>`

Store a memory in the specified tier. Tier must be `working`, `episodic`, or `semantic`.

```bash
# Working memory with custom key and TTL
engram store working "reviewing PR #42" --key current-task --ttl 300000

# Episodic memory
engram store episodic "User reported billing bug" --who user --context support --outcome "filed ticket"

# Semantic memory with confidence
engram store semantic "Billing bugs peak on Mondays" --topic billing --confidence 0.85
```

**Working memory flags:**

| Flag | Default | Description |
|---|---|---|
| `--key <key>` | Auto-generated | Key name |
| `--ttl <ms>` | 300000 (5 min) | Time-to-live in milliseconds |

**Episodic memory flags:**

| Flag | Default | Description |
|---|---|---|
| `--who <who>` | `system` | Who was involved |
| `--context <ctx>` | `""` | Context of the event |
| `--outcome <outcome>` | `""` | What happened as a result |
| `--visibility <v>` | `private` | `private`, `team`, or `public` |

**Semantic memory flags:**

| Flag | Default | Description |
|---|---|---|
| `--topic <topic>` | `general` | Topic category |
| `--confidence <n>` | `1.0` | Confidence score (0 to 1) |
| `--visibility <v>` | `private` | `private`, `team`, or `public` |

---

### `engram recall <query>`

Search memories using a natural language query. Results are ranked by relevance, recency, confidence, and access frequency.

```bash
engram recall "billing issues"
engram recall "deployment" --tiers episodic,semantic --max-results 5
engram recall "user preferences" --min-confidence 0.7
```

| Flag | Default | Description |
|---|---|---|
| `--tiers <tiers>` | `working,episodic,semantic` | Comma-separated tiers to search |
| `--max-results <n>` | 10 | Maximum number of results |
| `--max-tokens <n>` | -- | Token budget limit |
| `--min-confidence <n>` | -- | Minimum confidence for semantic results |

---

### `engram forget`

Run a forgetting policy. See [Forgetting Policies](forgetting.md) for details on each type.

```bash
# Time-based cleanup
engram forget --policy time_based --ttl-episodic 604800000

# Low-confidence cleanup
engram forget --policy confidence_based --confidence-threshold 0.3

# Inactive memory cleanup
engram forget --policy access_based --inactive-days 30

# Delete everything about a topic
engram forget --policy explicit --target "project-alpha"

# GDPR right-to-erasure
engram forget --policy gdpr --target "user@example.com"
```

| Flag | Policies | Description |
|---|---|---|
| `--policy <type>` | All | Required. One of: `time_based`, `confidence_based`, `access_based`, `explicit`, `gdpr` |
| `--ttl-working <ms>` | time_based | Working memory TTL |
| `--ttl-episodic <ms>` | time_based | Episodic memory TTL |
| `--ttl-semantic <ms>` | time_based | Semantic memory TTL |
| `--confidence-threshold <n>` | confidence_based | Threshold (default 0.3) |
| `--inactive-days <n>` | access_based | Days of inactivity (default 30) |
| `--target <entity>` | explicit, gdpr | Entity or topic to purge |

---

### `engram stats`

Show memory usage statistics for the current agent.

```bash
engram stats
```

Output includes counts, sizes, and averages per tier, plus quarantine and audit log totals.
