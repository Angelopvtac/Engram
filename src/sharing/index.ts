import type { MemoryStore } from "../store/index.js";
import type { SharingConfig, SharingVisibility, MemoryTier } from "../types.js";

/**
 * SharingManager — cross-agent memory sharing with access control.
 *
 * Working memory is always private. Episodic and semantic memories can be
 * shared with configurable visibility (private, team, public).
 */
export class SharingManager {
  constructor(private store: MemoryStore) {}

  /**
   * Configure sharing defaults for an agent.
   */
  configure(config: SharingConfig): void {
    this.store.db
      .prepare(
        `INSERT OR REPLACE INTO sharing_config (agent_id, team_id, default_episodic_visibility, default_semantic_visibility)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        config.agentId,
        config.teamId,
        config.defaultVisibility?.episodic ?? "private",
        config.defaultVisibility?.semantic ?? "private"
      );
  }

  /** Get the sharing configuration for an agent */
  getConfig(agentId: string): SharingConfig | null {
    const row = this.store.db
      .prepare(`SELECT * FROM sharing_config WHERE agent_id = ?`)
      .get(agentId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      agentId: row.agent_id as string,
      teamId: (row.team_id as string) ?? null,
      defaultVisibility: {
        working: "private",
        episodic: row.default_episodic_visibility as SharingVisibility,
        semantic: row.default_semantic_visibility as SharingVisibility,
      },
    };
  }

  /**
   * Share a specific episodic or semantic memory with a target visibility.
   * Working memory cannot be shared.
   */
  share(
    memoryId: string,
    tier: MemoryTier,
    visibility: SharingVisibility
  ): boolean {
    if (tier === "working") {
      return false; // Working memory is always private
    }

    const table = tier === "episodic" ? "episodic_memory" : "semantic_memory";
    const result = this.store.db
      .prepare(`UPDATE ${table} SET visibility = ? WHERE id = ?`)
      .run(visibility, memoryId);

    if (result.changes > 0) {
      this.store.audit({
        action: "share",
        memoryId,
        tier,
        agentId: "system",
        reason: `Visibility set to ${visibility}`,
      });
      return true;
    }

    return false;
  }

  /**
   * Revoke sharing — set a memory back to private.
   */
  revoke(memoryId: string, tier: MemoryTier): boolean {
    if (tier === "working") return false;

    const table = tier === "episodic" ? "episodic_memory" : "semantic_memory";
    const result = this.store.db
      .prepare(`UPDATE ${table} SET visibility = 'private' WHERE id = ?`)
      .run(memoryId);

    if (result.changes > 0) {
      this.store.audit({
        action: "revoke",
        memoryId,
        tier,
        agentId: "system",
        reason: "Sharing revoked, set to private",
      });
      return true;
    }

    return false;
  }

  /**
   * Get all memories shared with a team (team or public visibility).
   * Returns episodic and semantic memories visible to the team.
   */
  getTeamMemories(teamId: string): {
    episodic: Array<{ id: string; what: string; agentId: string; visibility: string }>;
    semantic: Array<{ id: string; fact: string; topic: string; agentId: string; visibility: string }>;
  } {
    // Find all agents in this team
    const agents = this.store.db
      .prepare(`SELECT agent_id FROM sharing_config WHERE team_id = ?`)
      .all(teamId) as { agent_id: string }[];

    const agentIds = agents.map((a) => a.agent_id);
    if (agentIds.length === 0) return { episodic: [], semantic: [] };

    const placeholders = agentIds.map(() => "?").join(", ");

    const episodic = this.store.db
      .prepare(
        `SELECT id, what, agent_id, visibility FROM episodic_memory
         WHERE agent_id IN (${placeholders}) AND visibility IN ('team', 'public')
         ORDER BY timestamp DESC LIMIT 100`
      )
      .all(...agentIds) as Array<{ id: string; what: string; agent_id: string; visibility: string }>;

    const semantic = this.store.db
      .prepare(
        `SELECT id, fact, topic, agent_id, visibility FROM semantic_memory
         WHERE agent_id IN (${placeholders}) AND visibility IN ('team', 'public')
         ORDER BY confidence DESC LIMIT 100`
      )
      .all(...agentIds) as Array<{ id: string; fact: string; topic: string; agent_id: string; visibility: string }>;

    return {
      episodic: episodic.map((r) => ({
        id: r.id,
        what: r.what,
        agentId: r.agent_id,
        visibility: r.visibility,
      })),
      semantic: semantic.map((r) => ({
        id: r.id,
        fact: r.fact,
        topic: r.topic,
        agentId: r.agent_id,
        visibility: r.visibility,
      })),
    };
  }

  /**
   * Get all publicly visible memories across all agents.
   */
  getPublicMemories(): {
    episodic: Array<{ id: string; what: string; agentId: string }>;
    semantic: Array<{ id: string; fact: string; topic: string; agentId: string }>;
  } {
    const episodic = this.store.db
      .prepare(
        `SELECT id, what, agent_id FROM episodic_memory WHERE visibility = 'public' ORDER BY timestamp DESC LIMIT 100`
      )
      .all() as Array<{ id: string; what: string; agent_id: string }>;

    const semantic = this.store.db
      .prepare(
        `SELECT id, fact, topic, agent_id FROM semantic_memory WHERE visibility = 'public' ORDER BY confidence DESC LIMIT 100`
      )
      .all() as Array<{ id: string; fact: string; topic: string; agent_id: string }>;

    return {
      episodic: episodic.map((r) => ({ id: r.id, what: r.what, agentId: r.agent_id })),
      semantic: semantic.map((r) => ({ id: r.id, fact: r.fact, topic: r.topic, agentId: r.agent_id })),
    };
  }
}
