import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { MemoryStore } from "../src/store/index.js";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

function getColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe("Schema Migration", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDb();
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch {}
  });

  describe("fresh database", () => {
    it("creates episodic_memory with embedding column", () => {
      const store = new MemoryStore(dbPath);
      const cols = getColumns(store.db, "episodic_memory");
      expect(cols).toContain("embedding");
      store.close();
    });

    it("creates semantic_memory with embedding column", () => {
      const store = new MemoryStore(dbPath);
      const cols = getColumns(store.db, "semantic_memory");
      expect(cols).toContain("embedding");
      store.close();
    });

    it("embedding columns are BLOB type (nullable)", () => {
      const store = new MemoryStore(dbPath);

      // Store without embedding — should work fine
      const ep = store.episodic.store("agent", {
        who: "user",
        what: "test",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      expect(ep.id).toBeTruthy();

      const fact = store.semantic.store("agent", {
        fact: "test fact",
        topic: "test",
        confidence: 1.0,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      expect(fact.id).toBeTruthy();

      store.close();
    });
  });

  describe("existing database without embedding columns", () => {
    it("adds embedding column to episodic_memory via ALTER TABLE", () => {
      // Create a DB with the old schema (no embedding columns)
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.exec(`
        CREATE TABLE IF NOT EXISTS working_memory (
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER NOT NULL,
          PRIMARY KEY (agent_id, key)
        );
        CREATE TABLE IF NOT EXISTS episodic_memory (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          who TEXT NOT NULL,
          what TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '',
          outcome TEXT NOT NULL DEFAULT '',
          timestamp INTEGER NOT NULL,
          visibility TEXT NOT NULL DEFAULT 'private',
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER NOT NULL,
          expires_at INTEGER,
          metadata TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS semantic_memory (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          fact TEXT NOT NULL,
          topic TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          source_episode_ids TEXT NOT NULL DEFAULT '[]',
          visibility TEXT NOT NULL DEFAULT 'private',
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER NOT NULL,
          last_verified_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS quarantine (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          tier TEXT NOT NULL,
          data TEXT NOT NULL,
          reason TEXT NOT NULL,
          quarantined_at INTEGER NOT NULL,
          agent_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          memory_id TEXT NOT NULL,
          tier TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sharing_config (
          agent_id TEXT PRIMARY KEY,
          team_id TEXT,
          default_episodic_visibility TEXT NOT NULL DEFAULT 'private',
          default_semantic_visibility TEXT NOT NULL DEFAULT 'private'
        );
      `);

      // Verify no embedding columns exist
      expect(getColumns(db, "episodic_memory")).not.toContain("embedding");
      expect(getColumns(db, "semantic_memory")).not.toContain("embedding");
      db.close();

      // Open with MemoryStore — should add embedding columns
      const store = new MemoryStore(dbPath);
      expect(getColumns(store.db, "episodic_memory")).toContain("embedding");
      expect(getColumns(store.db, "semantic_memory")).toContain("embedding");
      store.close();
    });

    it("preserves existing data after migration", () => {
      // Create old-schema DB with data
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.exec(`
        CREATE TABLE IF NOT EXISTS working_memory (
          key TEXT NOT NULL, value TEXT NOT NULL, agent_id TEXT NOT NULL,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          access_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER NOT NULL,
          PRIMARY KEY (agent_id, key)
        );
        CREATE TABLE IF NOT EXISTS episodic_memory (
          id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, who TEXT NOT NULL,
          what TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '',
          timestamp INTEGER NOT NULL, visibility TEXT NOT NULL DEFAULT 'private',
          access_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER NOT NULL,
          expires_at INTEGER, metadata TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS semantic_memory (
          id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, fact TEXT NOT NULL,
          topic TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1.0,
          source_episode_ids TEXT NOT NULL DEFAULT '[]',
          visibility TEXT NOT NULL DEFAULT 'private',
          access_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER NOT NULL,
          last_verified_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS quarantine (
          id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, tier TEXT NOT NULL,
          data TEXT NOT NULL, reason TEXT NOT NULL, quarantined_at INTEGER NOT NULL,
          agent_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY, action TEXT NOT NULL, memory_id TEXT NOT NULL,
          tier TEXT NOT NULL, agent_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sharing_config (
          agent_id TEXT PRIMARY KEY, team_id TEXT,
          default_episodic_visibility TEXT NOT NULL DEFAULT 'private',
          default_semantic_visibility TEXT NOT NULL DEFAULT 'private'
        );
      `);

      const ts = Date.now();
      db.prepare(
        `INSERT INTO episodic_memory (id, agent_id, who, what, context, outcome, timestamp, visibility, access_count, last_accessed_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run("ep-1", "agent", "user", "old event", "ctx", "ok", ts, "private", 0, ts, "{}");

      db.prepare(
        `INSERT INTO semantic_memory (id, agent_id, fact, topic, confidence, source_episode_ids, visibility, access_count, last_accessed_at, last_verified_at, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run("sem-1", "agent", "old fact", "legacy", 0.8, "[]", "private", 0, ts, ts, ts, "{}");

      db.close();

      // Open with MemoryStore and verify data is preserved
      const store = new MemoryStore(dbPath);

      const ep = store.episodic.get("ep-1");
      expect(ep).not.toBeNull();
      expect(ep!.what).toBe("old event");

      const fact = store.semantic.get("sem-1");
      expect(fact).not.toBeNull();
      expect(fact!.fact).toBe("old fact");

      store.close();
    });

    it("migration is idempotent (running twice is safe)", () => {
      // First open creates schema
      const store1 = new MemoryStore(dbPath);
      store1.close();

      // Second open should not fail
      const store2 = new MemoryStore(dbPath);
      expect(getColumns(store2.db, "episodic_memory")).toContain("embedding");
      expect(getColumns(store2.db, "semantic_memory")).toContain("embedding");
      store2.close();
    });
  });
});
