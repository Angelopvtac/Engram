import Database from "better-sqlite3";
import crypto from "node:crypto";
import { initSchema } from "./schema.js";
import type {
  WorkingEntry,
  Episode,
  SemanticFact,
  EpisodicSearchOptions,
  SemanticQueryOptions,
  SharingVisibility,
  AuditEntry,
  MemoryStats,
} from "../types.js";

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

/** Working memory tier — ephemeral key-value with TTL */
class WorkingMemoryTier {
  private lastPurge = 0;

  constructor(private db: Database.Database) {}

  /** Set a key-value pair with TTL in milliseconds */
  set(agentId: string, key: string, value: string, ttlMs: number): void {
    const ts = now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO working_memory (key, value, agent_id, created_at, expires_at, access_count, last_accessed_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`
      )
      .run(key, value, agentId, ts, ts + ttlMs, ts);
  }

  /** Get a value by key, returns null if expired or not found */
  get(agentId: string, key: string): WorkingEntry | null {
    this.purgeExpired();

    // Bump access count first so the returned object reflects the current count
    const result = this.db
      .prepare(
        `UPDATE working_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE agent_id = ? AND key = ? AND expires_at > ?`
      )
      .run(now(), agentId, key, now());

    if (result.changes === 0) return null;

    const row = this.db
      .prepare(
        `SELECT * FROM working_memory WHERE agent_id = ? AND key = ?`
      )
      .get(agentId, key) as Record<string, unknown> | undefined;

    if (!row) return null;

    return this.rowToEntry(row);
  }

  /** Delete a specific key */
  delete(agentId: string, key: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM working_memory WHERE agent_id = ? AND key = ?`)
      .run(agentId, key);
    return result.changes > 0;
  }

  /** Clear all working memory for an agent (session end) */
  clear(agentId: string): number {
    const result = this.db
      .prepare(`DELETE FROM working_memory WHERE agent_id = ?`)
      .run(agentId);
    return result.changes;
  }

  /** List all active entries for an agent */
  list(agentId: string): WorkingEntry[] {
    this.purgeExpired();
    const rows = this.db
      .prepare(
        `SELECT * FROM working_memory WHERE agent_id = ? AND expires_at > ? ORDER BY last_accessed_at DESC`
      )
      .all(agentId, now()) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  private purgeExpired(): void {
    const t = now();
    if (t - this.lastPurge < 5000) return;
    this.lastPurge = t;
    this.db
      .prepare(`DELETE FROM working_memory WHERE expires_at <= ?`)
      .run(t);
  }

  private rowToEntry(row: Record<string, unknown>): WorkingEntry {
    return {
      key: row.key as string,
      value: row.value as string,
      agentId: row.agent_id as string,
      createdAt: row.created_at as number,
      expiresAt: row.expires_at as number,
      accessCount: row.access_count as number,
      lastAccessedAt: row.last_accessed_at as number,
    };
  }
}

/** Episodic memory tier — searchable past interactions */
class EpisodicMemoryTier {
  constructor(private db: Database.Database) {}

  /** Store a new episode */
  store(
    agentId: string,
    episode: Omit<Episode, "id" | "agentId" | "accessCount" | "lastAccessedAt">
  ): Episode {
    const id = uuid();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO episodic_memory (id, agent_id, who, what, context, outcome, timestamp, visibility, access_count, last_accessed_at, expires_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        id,
        agentId,
        episode.who,
        episode.what,
        episode.context || "",
        episode.outcome || "",
        episode.timestamp,
        episode.visibility || "private",
        ts,
        episode.expiresAt ?? null,
        JSON.stringify(episode.metadata || {})
      );

    return {
      id,
      agentId,
      who: episode.who,
      what: episode.what,
      context: episode.context || "",
      outcome: episode.outcome || "",
      timestamp: episode.timestamp,
      visibility: episode.visibility || "private",
      accessCount: 0,
      lastAccessedAt: ts,
      expiresAt: episode.expiresAt ?? null,
      metadata: episode.metadata || {},
    };
  }

  /** Get a single episode by ID */
  get(id: string): Episode | null {
    const row = this.db
      .prepare(`SELECT * FROM episodic_memory WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.bumpAccess(id);
    return this.rowToEpisode(row);
  }

  /** Search episodes by keyword query */
  search(query: string, opts: EpisodicSearchOptions = {}): Episode[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query) {
      // Split query into words and match any of them across fields
      const words = query.split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        const wordClauses = words.map(() =>
          `(what LIKE ? OR context LIKE ? OR outcome LIKE ? OR who LIKE ?)`
        );
        conditions.push(`(${wordClauses.join(" OR ")})`);
        for (const word of words) {
          const pattern = `%${word}%`;
          params.push(pattern, pattern, pattern, pattern);
        }
      }
    }

    if (opts.agentId) {
      conditions.push(`agent_id = ?`);
      params.push(opts.agentId);
    }

    if (opts.timeRange) {
      conditions.push(`timestamp >= ? AND timestamp <= ?`);
      params.push(opts.timeRange.start, opts.timeRange.end);
    }

    if (opts.visibility) {
      conditions.push(`visibility = ?`);
      params.push(opts.visibility);
    }

    // Exclude expired
    conditions.push(`(expires_at IS NULL OR expires_at > ?)`);
    params.push(now());

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 50;

    const rows = this.db
      .prepare(
        `SELECT * FROM episodic_memory ${where} ORDER BY timestamp DESC LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEpisode(r));
  }

  /** Delete an episode by ID */
  delete(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM episodic_memory WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  private bumpAccess(id: string): void {
    this.db
      .prepare(
        `UPDATE episodic_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`
      )
      .run(now(), id);
  }

  private rowToEpisode(row: Record<string, unknown>): Episode {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      who: row.who as string,
      what: row.what as string,
      context: row.context as string,
      outcome: row.outcome as string,
      timestamp: row.timestamp as number,
      visibility: row.visibility as SharingVisibility,
      accessCount: row.access_count as number,
      lastAccessedAt: row.last_accessed_at as number,
      expiresAt: (row.expires_at as number) ?? null,
      metadata: JSON.parse((row.metadata as string) || "{}"),
    };
  }
}

/** Semantic memory tier — learned facts, patterns, preferences */
class SemanticMemoryTier {
  constructor(private db: Database.Database) {}

  /** Store a new semantic fact */
  store(
    agentId: string,
    fact: Omit<SemanticFact, "id" | "agentId" | "accessCount" | "lastAccessedAt" | "lastVerifiedAt" | "createdAt">
  ): SemanticFact {
    const id = uuid();
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO semantic_memory (id, agent_id, fact, topic, confidence, source_episode_ids, visibility, access_count, last_accessed_at, last_verified_at, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(
        id,
        agentId,
        fact.fact,
        fact.topic,
        fact.confidence ?? 1.0,
        JSON.stringify(fact.sourceEpisodeIds || []),
        fact.visibility || "private",
        ts,
        ts,
        ts,
        JSON.stringify(fact.metadata || {})
      );

    return {
      id,
      agentId,
      fact: fact.fact,
      topic: fact.topic,
      confidence: fact.confidence ?? 1.0,
      sourceEpisodeIds: fact.sourceEpisodeIds || [],
      visibility: fact.visibility || "private",
      accessCount: 0,
      lastAccessedAt: ts,
      lastVerifiedAt: ts,
      createdAt: ts,
      metadata: fact.metadata || {},
    };
  }

  /** Get a single semantic fact by ID */
  get(id: string): SemanticFact | null {
    const row = this.db
      .prepare(`SELECT * FROM semantic_memory WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.bumpAccess(id);
    return this.rowToFact(row);
  }

  /** Query semantic facts by topic */
  query(topic: string, opts: SemanticQueryOptions = {}): SemanticFact[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Split topic into words and match any across topic/fact fields
    const words = topic.split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const wordClauses = words.map(() => `(topic LIKE ? OR fact LIKE ?)`);
      conditions.push(`(${wordClauses.join(" OR ")})`);
      for (const word of words) {
        const pattern = `%${word}%`;
        params.push(pattern, pattern);
      }
    }

    if (opts.agentId) {
      conditions.push(`agent_id = ?`);
      params.push(opts.agentId);
    }

    if (opts.minConfidence !== undefined) {
      conditions.push(`confidence >= ?`);
      params.push(opts.minConfidence);
    }

    if (opts.visibility) {
      conditions.push(`visibility = ?`);
      params.push(opts.visibility);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 50;

    const rows = this.db
      .prepare(
        `SELECT * FROM semantic_memory ${where} ORDER BY confidence DESC, last_verified_at DESC LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToFact(r));
  }

  /** Update fields on an existing semantic fact */
  update(
    id: string,
    updates: Partial<Pick<SemanticFact, "fact" | "confidence" | "topic" | "visibility" | "metadata">>
  ): SemanticFact | null {
    // Check existence without bumping access count
    const row = this.db
      .prepare(`SELECT id FROM semantic_memory WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.fact !== undefined) {
      sets.push("fact = ?");
      params.push(updates.fact);
    }
    if (updates.confidence !== undefined) {
      sets.push("confidence = ?");
      params.push(updates.confidence);
    }
    if (updates.topic !== undefined) {
      sets.push("topic = ?");
      params.push(updates.topic);
    }
    if (updates.visibility !== undefined) {
      sets.push("visibility = ?");
      params.push(updates.visibility);
    }
    if (updates.metadata !== undefined) {
      sets.push("metadata = ?");
      params.push(JSON.stringify(updates.metadata));
    }

    sets.push("last_verified_at = ?");
    params.push(now());

    params.push(id);
    this.db
      .prepare(`UPDATE semantic_memory SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);

    return this.get(id);
  }

  /** Delete a semantic fact by ID */
  delete(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM semantic_memory WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  private bumpAccess(id: string): void {
    this.db
      .prepare(
        `UPDATE semantic_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`
      )
      .run(now(), id);
  }

  private rowToFact(row: Record<string, unknown>): SemanticFact {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      fact: row.fact as string,
      topic: row.topic as string,
      confidence: row.confidence as number,
      sourceEpisodeIds: JSON.parse((row.source_episode_ids as string) || "[]"),
      visibility: row.visibility as SharingVisibility,
      accessCount: row.access_count as number,
      lastAccessedAt: row.last_accessed_at as number,
      lastVerifiedAt: row.last_verified_at as number,
      createdAt: row.created_at as number,
      metadata: JSON.parse((row.metadata as string) || "{}"),
    };
  }
}

/**
 * MemoryStore — the central 3-tier memory store backed by SQLite.
 *
 * Provides tier-specific CRUD via `.working`, `.episodic`, and `.semantic` sub-APIs
 * plus audit logging and statistics.
 */
export class MemoryStore {
  /** @internal — do not use directly; prefer tier-specific sub-APIs */
  readonly db: Database.Database;
  readonly working: WorkingMemoryTier;
  readonly episodic: EpisodicMemoryTier;
  readonly semantic: SemanticMemoryTier;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initSchema(this.db);
    this.working = new WorkingMemoryTier(this.db);
    this.episodic = new EpisodicMemoryTier(this.db);
    this.semantic = new SemanticMemoryTier(this.db);
  }

  /** Write an audit log entry */
  audit(entry: Omit<AuditEntry, "id" | "timestamp">): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (id, action, memory_id, tier, agent_id, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(uuid(), entry.action, entry.memoryId, entry.tier, entry.agentId, entry.reason || "", now());
  }

  /** Get memory statistics */
  stats(agentId?: string): MemoryStats {
    const agentFilter = agentId ? `WHERE agent_id = ?` : "";
    const params = agentId ? [agentId] : [];

    const workingCount = (
      this.db
        .prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(value)), 0) as sz FROM working_memory ${agentFilter}`)
        .get(...params) as { cnt: number; sz: number }
    );

    const episodicRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(what) + LENGTH(context) + LENGTH(outcome)), 0) as sz, COALESCE(AVG(? - timestamp), 0) as avg_age FROM episodic_memory ${agentFilter}`
      )
      .get(now(), ...params) as { cnt: number; sz: number; avg_age: number };

    const semanticRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(fact)), 0) as sz, COALESCE(AVG(confidence), 0) as avg_conf FROM semantic_memory ${agentFilter}`
      )
      .get(...params) as { cnt: number; sz: number; avg_conf: number };

    const quarantineCount = (
      this.db
        .prepare(`SELECT COUNT(*) as cnt FROM quarantine ${agentFilter}`)
        .get(...params) as { cnt: number }
    ).cnt;

    const auditCount = (
      this.db
        .prepare(`SELECT COUNT(*) as cnt FROM audit_log ${agentFilter}`)
        .get(...params) as { cnt: number }
    ).cnt;

    return {
      working: { count: workingCount.cnt, totalSize: workingCount.sz },
      episodic: { count: episodicRow.cnt, totalSize: episodicRow.sz, avgAge: episodicRow.avg_age },
      semantic: { count: semanticRow.cnt, totalSize: semanticRow.sz, avgConfidence: semanticRow.avg_conf },
      quarantined: quarantineCount,
      auditEntries: auditCount,
    };
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}
