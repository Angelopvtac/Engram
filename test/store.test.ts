import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MemoryStore } from "../src/store/index.js";

const AGENT = "test-agent";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

describe("MemoryStore", () => {
  let dbPath: string;
  let store: MemoryStore;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new MemoryStore(dbPath);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    try { fs.unlinkSync(dbPath); } catch {}
  });

  // ── Working Memory ──────────────────────────────────────────────────

  describe("working memory", () => {
    it("set and get round-trip", () => {
      store.working.set(AGENT, "greeting", "hello world", 60_000);
      const entry = store.working.get(AGENT, "greeting");
      expect(entry).not.toBeNull();
      expect(entry!.key).toBe("greeting");
      expect(entry!.value).toBe("hello world");
      expect(entry!.agentId).toBe(AGENT);
    });

    it("returns null for non-existent key", () => {
      const entry = store.working.get(AGENT, "nope");
      expect(entry).toBeNull();
    });

    it("TTL expiry returns null after expiration", async () => {
      store.working.set(AGENT, "temp", "ephemeral", 50); // 50ms TTL
      await new Promise((r) => setTimeout(r, 100));
      const entry = store.working.get(AGENT, "temp");
      expect(entry).toBeNull();
    });

    it("delete removes entry", () => {
      store.working.set(AGENT, "del-me", "gone", 60_000);
      const deleted = store.working.delete(AGENT, "del-me");
      expect(deleted).toBe(true);
      expect(store.working.get(AGENT, "del-me")).toBeNull();
    });

    it("delete returns false for non-existent key", () => {
      expect(store.working.delete(AGENT, "ghost")).toBe(false);
    });

    it("clear removes all entries for an agent", () => {
      store.working.set(AGENT, "a", "1", 60_000);
      store.working.set(AGENT, "b", "2", 60_000);
      store.working.set("other-agent", "c", "3", 60_000);

      const cleared = store.working.clear(AGENT);
      expect(cleared).toBe(2);
      expect(store.working.list(AGENT)).toHaveLength(0);
      expect(store.working.list("other-agent")).toHaveLength(1);
    });

    it("list returns active entries", () => {
      store.working.set(AGENT, "x", "1", 60_000);
      store.working.set(AGENT, "y", "2", 60_000);
      const entries = store.working.list(AGENT);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.key).sort()).toEqual(["x", "y"]);
    });

    it("access count increments on get", () => {
      store.working.set(AGENT, "counter", "val", 60_000);
      store.working.get(AGENT, "counter"); // bumps to 1
      store.working.get(AGENT, "counter"); // bumps to 2
      const entry = store.working.get(AGENT, "counter"); // bumps to 3, returns 3
      // Access count is bumped before reading, so the returned object
      // reflects the current count.
      expect(entry!.accessCount).toBe(3);
    });
  });

  // ── Episodic Memory ─────────────────────────────────────────────────

  describe("episodic memory", () => {
    it("store and get round-trip", () => {
      const ep = store.episodic.store(AGENT, {
        who: "user",
        what: "asked about weather",
        context: "morning chat",
        outcome: "provided forecast",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: { mood: "curious" },
      });

      expect(ep.id).toBeTruthy();
      expect(ep.agentId).toBe(AGENT);

      const fetched = store.episodic.get(ep.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.what).toBe("asked about weather");
      expect(fetched!.metadata).toEqual({ mood: "curious" });
    });

    it("search by keyword", () => {
      store.episodic.store(AGENT, {
        who: "user",
        what: "deployed the microservice",
        context: "production",
        outcome: "success",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      store.episodic.store(AGENT, {
        who: "user",
        what: "wrote unit tests",
        context: "development",
        outcome: "all passing",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      const results = store.episodic.search("microservice");
      expect(results).toHaveLength(1);
      expect(results[0].what).toContain("microservice");
    });

    it("search by agent", () => {
      store.episodic.store(AGENT, {
        who: "user",
        what: "event A",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      store.episodic.store("other-agent", {
        who: "admin",
        what: "event B",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      const results = store.episodic.search("event", { agentId: AGENT });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe(AGENT);
    });

    it("search by time range", () => {
      const now = Date.now();
      store.episodic.store(AGENT, {
        who: "user",
        what: "old event",
        context: "",
        outcome: "",
        timestamp: now - 100_000,
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      store.episodic.store(AGENT, {
        who: "user",
        what: "recent event",
        context: "",
        outcome: "",
        timestamp: now,
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      const results = store.episodic.search("event", {
        timeRange: { start: now - 50_000, end: now + 1000 },
      });
      expect(results).toHaveLength(1);
      expect(results[0].what).toBe("recent event");
    });

    it("search by visibility", () => {
      store.episodic.store(AGENT, {
        who: "user",
        what: "private note",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      store.episodic.store(AGENT, {
        who: "user",
        what: "team note",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "team",
        expiresAt: null,
        metadata: {},
      });

      const results = store.episodic.search("note", { visibility: "team" });
      expect(results).toHaveLength(1);
      expect(results[0].visibility).toBe("team");
    });

    it("delete removes episode", () => {
      const ep = store.episodic.store(AGENT, {
        who: "user",
        what: "transient",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      expect(store.episodic.delete(ep.id)).toBe(true);
      expect(store.episodic.get(ep.id)).toBeNull();
    });
  });

  // ── Semantic Memory ─────────────────────────────────────────────────

  describe("semantic memory", () => {
    it("store and get round-trip", () => {
      const fact = store.semantic.store(AGENT, {
        fact: "TypeScript is a typed superset of JavaScript",
        topic: "programming languages",
        confidence: 0.95,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      expect(fact.id).toBeTruthy();
      expect(fact.confidence).toBe(0.95);

      const fetched = store.semantic.get(fact.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.fact).toContain("TypeScript");
    });

    it("query by topic", () => {
      store.semantic.store(AGENT, {
        fact: "Python uses indentation for blocks",
        topic: "python",
        confidence: 0.9,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      store.semantic.store(AGENT, {
        fact: "Rust has zero-cost abstractions",
        topic: "rust",
        confidence: 0.85,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const results = store.semantic.query("python", { agentId: AGENT });
      expect(results).toHaveLength(1);
      expect(results[0].topic).toBe("python");
    });

    it("query with minConfidence", () => {
      store.semantic.store(AGENT, {
        fact: "high confidence fact",
        topic: "testing",
        confidence: 0.9,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      store.semantic.store(AGENT, {
        fact: "low confidence testing guess",
        topic: "testing",
        confidence: 0.2,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const results = store.semantic.query("testing", {
        agentId: AGENT,
        minConfidence: 0.5,
      });
      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("update fields", () => {
      const fact = store.semantic.store(AGENT, {
        fact: "original fact",
        topic: "updates",
        confidence: 0.5,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const updated = store.semantic.update(fact.id, {
        fact: "revised fact",
        confidence: 0.9,
      });
      expect(updated).not.toBeNull();
      expect(updated!.fact).toBe("revised fact");
      expect(updated!.confidence).toBe(0.9);
    });

    it("query with empty topic and no filters returns all facts", () => {
      store.semantic.store(AGENT, {
        fact: "fact one",
        topic: "alpha",
        confidence: 0.9,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      store.semantic.store(AGENT, {
        fact: "fact two",
        topic: "beta",
        confidence: 0.8,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      // Empty topic + no filters should NOT crash (was a SQL bug)
      const results = store.semantic.query("");
      expect(results).toHaveLength(2);
    });

    it("update only bumps access count once", () => {
      const fact = store.semantic.store(AGENT, {
        fact: "original",
        topic: "counting",
        confidence: 0.5,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      // accessCount starts at 0 after store
      expect(fact.accessCount).toBe(0);

      store.semantic.update(fact.id, { confidence: 0.9 });
      // update calls get() once at the end, which bumps DB to 1 but returns pre-bump value (0).
      // A subsequent get() should read 1 (from the update's bump), then bump to 2.
      const fetched = store.semantic.get(fact.id);
      // get() returns pre-bump value: DB was 1, get reads 1, bumps to 2, returns 1
      expect(fetched!.accessCount).toBe(1);
    });

    it("delete removes fact", () => {
      const fact = store.semantic.store(AGENT, {
        fact: "deletable",
        topic: "cleanup",
        confidence: 1.0,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      expect(store.semantic.delete(fact.id)).toBe(true);
      expect(store.semantic.get(fact.id)).toBeNull();
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────

  describe("stats", () => {
    it("reflects counts after storing items", () => {
      store.working.set(AGENT, "k1", "v1", 60_000);
      store.working.set(AGENT, "k2", "v2", 60_000);

      store.episodic.store(AGENT, {
        who: "user",
        what: "something happened",
        context: "ctx",
        outcome: "ok",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      store.semantic.store(AGENT, {
        fact: "a fact",
        topic: "stats",
        confidence: 0.8,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      const s = store.stats(AGENT);
      expect(s.working.count).toBe(2);
      expect(s.episodic.count).toBe(1);
      expect(s.semantic.count).toBe(1);
      expect(s.semantic.avgConfidence).toBeCloseTo(0.8, 1);
    });
  });

  // ── Audit ───────────────────────────────────────────────────────────

  describe("audit", () => {
    it("records audit log entries", () => {
      store.audit({
        action: "store",
        memoryId: "mem-1",
        tier: "episodic",
        agentId: AGENT,
        reason: "user created",
      });
      store.audit({
        action: "delete",
        memoryId: "mem-2",
        tier: "semantic",
        agentId: AGENT,
        reason: "cleanup",
      });

      const s = store.stats(AGENT);
      expect(s.auditEntries).toBe(2);
    });
  });
});
