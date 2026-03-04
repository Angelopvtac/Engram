# Sharing & Visibility

Engram supports cross-agent memory sharing through configurable visibility levels. This enables multi-agent systems where agents collaborate by sharing relevant knowledge.

## Visibility Levels

| Level | Who can see it |
|---|---|
| `private` | Only the owning agent |
| `team` | All agents on the same team |
| `public` | All agents across all teams |

**Working memory is always private** and cannot be shared. Only episodic and semantic memories support visibility changes.

## Setup

```typescript
import { SharingManager } from 'engram';

const sharing = new SharingManager(store);

// Configure an agent with a team and default visibility
sharing.configure({
  agentId: 'agent-1',
  teamId: 'research-team',
  defaultVisibility: {
    episodic: 'private',
    semantic: 'team'    // new facts are team-visible by default
  }
});
```

## API

### `sharing.configure(config)`

Set sharing defaults for an agent. Call this during agent initialization.

```typescript
sharing.configure({
  agentId: string;
  teamId: string | null;
  defaultVisibility: {
    episodic?: "private" | "team" | "public";
    semantic?: "private" | "team" | "public";
  };
});
```

### `sharing.getConfig(agentId)`

Retrieve the sharing config for an agent. Returns `null` if not configured.

### `sharing.share(memoryId, tier, visibility)`

Change the visibility of a specific memory.

```typescript
// Make a fact visible to the team
sharing.share(fact.id, 'semantic', 'team');

// Make an episode public
sharing.share(episode.id, 'episodic', 'public');

// Working memory cannot be shared (returns false)
sharing.share(entryId, 'working', 'team'); // => false
```

Returns `true` on success, `false` if the memory doesn't exist or is working tier.

### `sharing.revoke(memoryId, tier)`

Set a memory back to `private`.

```typescript
sharing.revoke(fact.id, 'semantic'); // => true
```

### `sharing.getTeamMemories(teamId)`

Get all team-visible and public memories for agents on a team.

```typescript
const { episodic, semantic } = sharing.getTeamMemories('research-team');
```

Returns up to 100 episodic and 100 semantic memories, sorted by timestamp and confidence respectively.

### `sharing.getPublicMemories()`

Get all public-visibility memories across all agents.

```typescript
const { episodic, semantic } = sharing.getPublicMemories();
```

## Audit Trail

Every `share` and `revoke` operation is recorded in the audit log with the memory ID, tier, and new visibility level.
