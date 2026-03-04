import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MemoryStore } from "../src/store/index.js";
import { ForgettingEngine } from "../src/forgetting/index.js";

const AGENT = "test-agent";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

describe("ForgettingEngine", () => {
  let dbPath: string;
  let store: MemoryStore;
  let engine: ForgettingEngine;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new MemoryStore(dbPath);
    engine = new ForgettingEngine(store);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    try { fs.unlinkSync(dbPath); } catch {}
  });

  // ── time_based ──────────────────────────────────────────────────────

  describe("time_based policy", () => {
    it("deletes old episodic memories past TTL", () => {
      // Insert an episode with old timestamp via direct SQL
      const oldTs = Date.now() - 100_000;
      store.db
        .prepare(
          `INSERT INTO episodic_memory (id, agent_id, who, what, context, outcome, timestamp, visibility, access_count, last_accessed_at, expires_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, '{}')`
        )
        .run("old-ep-1", AGENT, "user", "ancient event", "", "", oldTs, "private", oldTs);

      // Insert a recent episode that should survive
      store.episodic.store(AGENT, {
        who: "user",
        what: "recent event",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      const report = engine.execute(
        { name: "time-cleanup", type: "time_based", ttl: { episodic: 50_000 } },
        AGENT
      );

      expect(report.deleted).toBe(1);
      expect(report.reasons[0].action).toBe("deleted");
      expect(report.reasons[0].tier).toBe("episodic");

      // Verify the old one is gone and the recent one remains
      expect(store.episodic.get("old-ep-1")).toBeNull();
      expect(store.episodic.search("recent")).toHaveLength(1);
    });

    it("deletes old working memory entries", () => {
      const oldTs = Date.now() - 200_000;
      store.db
        .prepare(
          `INSERT INTO working_memory (key, value, agent_id, created_at, expires_at, access_count, last_accessed_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)`
        )
        .run("old-key", "old-val", AGENT, oldTs, Date.now() + 999_999, oldTs);

      store.working.set(AGENT, "fresh-key", "fresh-val", 600_000);

      const report = engine.execute(
        { name: "wk-cleanup", type: "time_based", ttl: { working: 100_000 } },
        AGENT
      );

      expect(report.deleted).toBe(1);
      expect(store.working.get(AGENT, "old-key")).toBeNull();
      expect(store.working.get(AGENT, "fresh-key")).not.toBeNull();
    });

    it("deletes old semantic memories past TTL", () => {
      const oldTs = Date.now() - 200_000;
      store.db
        .prepare(
          `INSERT INTO semantic_memory (id, agent_id, fact, topic, confidence, source_episode_ids, visibility, access_count, last_accessed_at, last_verified_at, created_at, metadata)
           VALUES (?, ?, ?, ?, ?, '[]', 'private', 0, ?, ?, ?, '{}')`
        )
        .run("old-sem-1", AGENT, "stale fact", "old-topic", 0.5, oldTs, oldTs, oldTs);

      store.semantic.store(AGENT, {
        fact: "fresh fact",
        topic: "new-topic",
        confidence: 0.9,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const report = engine.execute(
        { name: "sem-cleanup", type: "time_based", ttl: { semantic: 100_000 } },
        AGENT
      );

      expect(report.deleted).toBe(1);
      expect(store.semantic.get("old-sem-1")).toBeNull();
    });
    it("creates audit entries for time-based deletions", () => {
      const oldTs = Date.now() - 100_000;
      store.db
        .prepare(
          `INSERT INTO episodic_memory (id, agent_id, who, what, context, outcome, timestamp, visibility, access_count, last_accessed_at, expires_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, '{}')`
        )
        .run("audit-ep-1", AGENT, "user", "old event", "", "", oldTs, "private", oldTs);

      const auditsBefore = (store.db
        .prepare(`SELECT COUNT(*) as cnt FROM audit_log`)
        .get() as { cnt: number }).cnt;

      engine.execute(
        { name: "time-audit", type: "time_based", ttl: { episodic: 50_000 } },
        AGENT
      );

      const auditsAfter = (store.db
        .prepare(`SELECT COUNT(*) as cnt FROM audit_log`)
        .get() as { cnt: number }).cnt;

      expect(auditsAfter).toBeGreaterThan(auditsBefore);

      // Verify the audit entry has the right action and tier
      const entry = store.db
        .prepare(`SELECT * FROM audit_log WHERE memory_id = 'audit-ep-1'`)
        .get() as { action: string; tier: string } | undefined;
      expect(entry).toBeTruthy();
      expect(entry!.action).toBe("delete");
      expect(entry!.tier).toBe("episodic");
    });
  });

  // ── confidence_based ────────────────────────────────────────────────

  describe("confidence_based policy", () => {
    it("deletes very low confidence and demotes low confidence to episodic", () => {
      // Very low confidence -> should be deleted (below threshold/2 = 0.15)
      store.semantic.store(AGENT, {
        fact: "totally unreliable guess",
        topic: "guesses",
        confidence: 0.1,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      // Low confidence -> should be demoted (between 0.15 and 0.3)
      store.semantic.store(AGENT, {
        fact: "somewhat shaky claim",
        topic: "guesses",
        confidence: 0.25,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      // High confidence -> should be retained
      store.semantic.store(AGENT, {
        fact: "solid verified fact",
        topic: "verified",
        confidence: 0.9,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const report = engine.execute(
        { name: "conf-cleanup", type: "confidence_based", confidenceThreshold: 0.3 },
        AGENT
      );

      expect(report.deleted).toBe(1);
      expect(report.demoted).toBe(1);

      // The high-confidence fact should still exist in semantic
      const remaining = store.semantic.query("verified", { agentId: AGENT });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].confidence).toBe(0.9);

      // A demoted episode should exist for the shaky claim
      const demotedEpisodes = store.episodic.search("Demoted semantic fact");
      expect(demotedEpisodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── access_based ────────────────────────────────────────────────────

  describe("access_based policy", () => {
    it("deletes inactive episodic and demotes inactive semantic", () => {
      const oldAccess = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago

      // Episodic with old last_accessed_at
      store.db
        .prepare(
          `INSERT INTO episodic_memory (id, agent_id, who, what, context, outcome, timestamp, visibility, access_count, last_accessed_at, expires_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, '{}')`
        )
        .run("stale-ep", AGENT, "user", "forgotten conversation", "", "", Date.now() - 50_000, "private", oldAccess);

      // Semantic with old last_accessed_at
      store.db
        .prepare(
          `INSERT INTO semantic_memory (id, agent_id, fact, topic, confidence, source_episode_ids, visibility, access_count, last_accessed_at, last_verified_at, created_at, metadata)
           VALUES (?, ?, ?, ?, ?, '[]', 'private', 1, ?, ?, ?, '{}')`
        )
        .run("stale-sem", AGENT, "unused knowledge", "dormant", 0.7, oldAccess, oldAccess, oldAccess);

      // Recent entries that should survive
      store.episodic.store(AGENT, {
        who: "user",
        what: "active conversation",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      const report = engine.execute(
        { name: "access-cleanup", type: "access_based", inactiveDays: 30 },
        AGENT
      );

      expect(report.deleted).toBeGreaterThanOrEqual(1); // stale episodic deleted
      expect(report.demoted).toBeGreaterThanOrEqual(1); // stale semantic demoted

      expect(store.episodic.get("stale-ep")).toBeNull();
      expect(store.semantic.get("stale-sem")).toBeNull();

      // Demoted fact should appear in episodic
      const demoted = store.episodic.search("Demoted inactive fact");
      expect(demoted.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── explicit ────────────────────────────────────────────────────────

  describe("explicit policy", () => {
    it("deletes only memories matching target", () => {
      store.episodic.store(AGENT, {
        who: "alice",
        what: "alice shared credentials",
        context: "security incident",
        outcome: "revoked",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      store.episodic.store(AGENT, {
        who: "bob",
        what: "bob deployed the fix",
        context: "maintenance",
        outcome: "success",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      store.semantic.store(AGENT, {
        fact: "alice prefers dark mode",
        topic: "user preferences",
        confidence: 0.8,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const report = engine.execute(
        { name: "forget-alice", type: "explicit", target: "alice" },
        AGENT
      );

      // Should delete the episode about alice and the semantic fact about alice
      expect(report.deleted).toBe(2);

      // Bob's episode should still exist
      const bobResults = store.episodic.search("bob");
      expect(bobResults).toHaveLength(1);
    });
  });

  // ── gdpr ────────────────────────────────────────────────────────────

  describe("gdpr policy", () => {
    it("purges all tiers including working memory and quarantine", () => {
      // Working memory
      store.working.set(AGENT, "user-data-charlie", "charlie@example.com", 600_000);
      store.working.set(AGENT, "unrelated-key", "keep-this", 600_000);

      // Episodic
      store.episodic.store(AGENT, {
        who: "charlie",
        what: "charlie signed up",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      // Semantic
      store.semantic.store(AGENT, {
        fact: "charlie is in the EU timezone",
        topic: "user info",
        confidence: 0.9,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      // Quarantine entry with charlie in data
      store.db
        .prepare(
          `INSERT INTO quarantine (id, memory_id, tier, data, reason, quarantined_at, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("q1", "mem-charlie", "episodic", '{"who":"charlie"}', "test", Date.now(), AGENT);

      const report = engine.execute(
        { name: "gdpr-charlie", type: "gdpr", target: "charlie" },
        AGENT
      );

      expect(report.deleted).toBeGreaterThanOrEqual(3); // episodic + semantic + working

      // Working memory for charlie key should be gone
      expect(store.working.get(AGENT, "user-data-charlie")).toBeNull();
      // Unrelated key should survive
      expect(store.working.get(AGENT, "unrelated-key")).not.toBeNull();

      // Quarantine should be purged
      const quarantine = store.db
        .prepare(`SELECT COUNT(*) as cnt FROM quarantine WHERE data LIKE '%charlie%'`)
        .get() as { cnt: number };
      expect(quarantine.cnt).toBe(0);
    });

    it("purges audit log entries containing the target PII", () => {
      // Create some audit entries that reference the target
      store.audit({
        action: "store",
        memoryId: "mem-dave-1",
        tier: "episodic",
        agentId: AGENT,
        reason: 'Stored memory about dave',
      });
      store.audit({
        action: "store",
        memoryId: "mem-dave-2",
        tier: "semantic",
        agentId: AGENT,
        reason: 'dave prefers dark mode',
      });
      // Unrelated audit entry
      store.audit({
        action: "store",
        memoryId: "mem-other",
        tier: "episodic",
        agentId: AGENT,
        reason: "unrelated entry",
      });

      // Store a memory so GDPR has something to delete
      store.episodic.store(AGENT, {
        who: "dave",
        what: "dave signed up",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      engine.execute({ name: "gdpr-dave", type: "gdpr", target: "dave" }, AGENT);

      // Audit entries mentioning "dave" should be gone
      const daveAudits = store.db
        .prepare(`SELECT COUNT(*) as cnt FROM audit_log WHERE reason LIKE '%dave%'`)
        .get() as { cnt: number };
      expect(daveAudits.cnt).toBe(0);

      // Unrelated audit entry should survive
      const otherAudits = store.db
        .prepare(`SELECT COUNT(*) as cnt FROM audit_log WHERE reason = 'unrelated entry'`)
        .get() as { cnt: number };
      expect(otherAudits.cnt).toBe(1);

      // An anonymized completion entry should exist
      const gdprEntry = store.db
        .prepare(`SELECT * FROM audit_log WHERE reason = 'GDPR right-to-erasure completed'`)
        .get() as { memory_id: string } | undefined;
      expect(gdprEntry).toBeTruthy();
      // The memory_id should be a hash, not the raw target name
      expect(gdprEntry!.memory_id).toMatch(/^gdpr:[0-9a-f]{8}$/);
      expect(gdprEntry!.memory_id).not.toContain("dave");
    });
  });

  // ── LIKE wildcard injection ────────────────────────────────────────

  describe("LIKE wildcard safety", () => {
    it("does not treat % in target as a wildcard", () => {
      // Store a memory with % in content — should NOT be caught by a non-wildcard target
      store.episodic.store(AGENT, {
        who: "user",
        what: "100% completion rate",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      // Store a memory that actually matches the literal target
      store.episodic.store(AGENT, {
        who: "user",
        what: "met with specific-person",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      // Use a target with % — should be treated literally, not as a wildcard
      const report = engine.execute(
        { name: "wildcard-test", type: "explicit", target: "%" },
        AGENT
      );

      // Only the memory containing a literal "%" should match
      expect(report.deleted).toBe(1);
      expect(report.reasons[0].reason).toContain("%");

      // The other memory should still exist
      const remaining = store.episodic.search("specific-person");
      expect(remaining).toHaveLength(1);
    });
  });

  // ── executeAll ──────────────────────────────────────────────────────

  describe("executeAll", () => {
    it("runs multiple policies and returns reports for each", () => {
      store.episodic.store(AGENT, {
        who: "user",
        what: "some event",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      store.semantic.store(AGENT, {
        fact: "low confidence",
        topic: "guesses",
        confidence: 0.05,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const reports = engine.executeAll(
        [
          { name: "time-policy", type: "time_based", ttl: { episodic: 1 } },
          { name: "conf-policy", type: "confidence_based", confidenceThreshold: 0.3 },
        ],
        AGENT
      );

      expect(reports).toHaveLength(2);
      expect(reports[0].policy).toBe("time-policy");
      expect(reports[1].policy).toBe("conf-policy");
      // At least one deletion should have occurred across the two
      const totalDeleted = reports.reduce((s, r) => s + r.deleted, 0);
      expect(totalDeleted).toBeGreaterThanOrEqual(1);
    });
  });
});
