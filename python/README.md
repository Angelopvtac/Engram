# Engram Python SDK

Python client for the [Engram](https://github.com/Angelopvtac/engram) cognitive memory system.

## Installation

```bash
pip install engram-sdk
```

## Quick Start

```python
from engram import EngramClient

client = EngramClient()  # defaults to http://localhost:3847

# Store an episodic memory
result = client.store(
    tier="episodic",
    agent_id="agent-1",
    who="user",
    what="Discussed project architecture",
    context="design review meeting",
    outcome="Decided on microservices approach",
)

# Recall memories
memories = client.recall("project architecture", agent_id="agent-1")
for mem in memories.memories:
    print(f"[{mem.tier}] {mem.data}")

# Working memory
client.working_set("agent-1", "current_task", "code review")
entry = client.working_get("agent-1", "current_task")
print(entry.value)  # "code review"

# Stats
stats = client.stats()
print(f"Episodic: {stats.episodic.count}, Semantic: {stats.semantic.count}")
```

## Async Usage

```python
import asyncio
from engram import AsyncEngramClient

async def main():
    async with AsyncEngramClient() as client:
        result = await client.recall("project deadlines")
        print(result)

asyncio.run(main())
```

## Configuration

```python
client = EngramClient(
    base_url="http://custom-host:3847",
    timeout=60.0,
)
```
