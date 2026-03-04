import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MemoryStore } from "../src/store/index.js";
import { RecallEngine } from "../src/recall/index.js";

const AGENT = "test-agent";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

describe("RecallEngine", () => {
  let dbPath: string;
  let store: MemoryStore;
  let recall: RecallEngine;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new MemoryStore(dbPath);
    recall = new RecallEngine(store);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    try { fs.unlinkSync(dbPath); } catch {}
  });

  function seedAll() {
    store.working.set(AGENT, "current-task", "debugging authentication module", 300_000);

    store.episodic.store(AGENT, {
      who: "developer",
      what: "fixed authentication bug in login handler",
      context: "production incident",
      outcome: "resolved with token refresh",
      timestamp: Date.now() - 3600_000,
      visibility: "private",
      expiresAt: null,
      metadata: {},
    });

    store.semantic.store(AGENT, {
      fact: "JWT tokens expire after 15 minutes by default",
      topic: "authentication",
      confidence: 0.9,
      sourceEpisodeIds: [],
      visibility: "private",
      metadata: {},
    });
  }

  it("recalls items from all 3 tiers by keyword", () => {
    seedAll();

    const result = recall.recall("authentication", { agentId: AGENT });
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.query).toBe("authentication");

    const tiers = result.memories.map((m) => m.tier);
    // At least episodic and semantic should match "authentication"
    expect(tiers).toContain("episodic");
    expect(tiers).toContain("semantic");
  });

  it("returns results when query is empty", () => {
    seedAll();

    const result = recall.recall("", { agentId: AGENT });
    // Empty query still returns items (all working entries, and search("") returns episodes)
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("filters by specific tiers", () => {
    seedAll();

    const episodicOnly = recall.recall("authentication", {
      agentId: AGENT,
      tiers: ["episodic"],
    });
    for (const m of episodicOnly.memories) {
      expect(m.tier).toBe("episodic");
    }

    const semanticOnly = recall.recall("authentication", {
      agentId: AGENT,
      tiers: ["semantic"],
    });
    for (const m of semanticOnly.memories) {
      expect(m.tier).toBe("semantic");
    }
  });

  it("maxResults limits returned count", () => {
    // Seed many episodes
    for (let i = 0; i < 10; i++) {
      store.episodic.store(AGENT, {
        who: "user",
        what: `security event number ${i}`,
        context: "testing",
        outcome: "logged",
        timestamp: Date.now() - i * 1000,
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
    }

    const result = recall.recall("security", {
      agentId: AGENT,
      maxResults: 3,
    });
    expect(result.memories.length).toBeLessThanOrEqual(3);
  });

  it("maxTokens limits total token budget", () => {
    // Create memories with large content
    for (let i = 0; i < 5; i++) {
      store.episodic.store(AGENT, {
        who: "user",
        what: `network analysis report: ${"x".repeat(500)}`,
        context: "security review",
        outcome: "findings documented",
        timestamp: Date.now() - i * 1000,
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
    }

    const result = recall.recall("network", {
      agentId: AGENT,
      maxTokens: 200,
    });
    expect(result.totalTokens).toBeLessThanOrEqual(200);
  });

  it("more relevant results are ranked higher", () => {
    store.episodic.store(AGENT, {
      who: "user",
      what: "unrelated conversation about cooking pasta",
      context: "casual chat",
      outcome: "recipe shared",
      timestamp: Date.now(),
      visibility: "private",
      expiresAt: null,
      metadata: {},
    });

    store.episodic.store(AGENT, {
      who: "user",
      what: "database migration failed during deployment",
      context: "deployment pipeline",
      outcome: "rolled back deployment",
      timestamp: Date.now(),
      visibility: "private",
      expiresAt: null,
      metadata: {},
    });

    const result = recall.recall("database deployment migration", {
      agentId: AGENT,
    });
    expect(result.memories.length).toBeGreaterThan(0);
    // The database/deployment episode should be first
    const first = result.memories[0];
    expect(first.tier).toBe("episodic");
    if (first.tier === "episodic") {
      expect(first.data.what).toContain("database");
    }
  });

  it("minConfidence filters semantic facts", () => {
    store.semantic.store(AGENT, {
      fact: "reliable encryption fact about AES-256",
      topic: "encryption",
      confidence: 0.95,
      sourceEpisodeIds: [],
      visibility: "private",
      metadata: {},
    });
    store.semantic.store(AGENT, {
      fact: "unreliable encryption rumor about quantum",
      topic: "encryption",
      confidence: 0.1,
      sourceEpisodeIds: [],
      visibility: "private",
      metadata: {},
    });

    const result = recall.recall("encryption", {
      agentId: AGENT,
      tiers: ["semantic"],
      minConfidence: 0.5,
    });
    // Only the high-confidence fact should be returned
    expect(result.memories).toHaveLength(1);
    const fact = result.memories[0];
    expect(fact.tier).toBe("semantic");
    if (fact.tier === "semantic") {
      expect(fact.data.confidence).toBeGreaterThanOrEqual(0.5);
    }
  });
});
