import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MemoryStore } from "../src/store/index.js";
import { IntegrityGuard } from "../src/integrity/index.js";
import type { Memory } from "../src/types.js";

const AGENT = "test-agent";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

function makeEpisodic(what: string): Memory {
  return {
    tier: "episodic",
    data: {
      id: crypto.randomUUID(),
      agentId: AGENT,
      who: "user",
      what,
      context: "test context",
      outcome: "test outcome",
      timestamp: Date.now(),
      visibility: "private",
      accessCount: 0,
      lastAccessedAt: Date.now(),
      expiresAt: null,
      metadata: {},
    },
  };
}

function makeSemantic(fact: string, topic: string): Memory {
  return {
    tier: "semantic",
    data: {
      id: crypto.randomUUID(),
      agentId: AGENT,
      fact,
      topic,
      confidence: 0.9,
      sourceEpisodeIds: [],
      visibility: "private",
      accessCount: 0,
      lastAccessedAt: Date.now(),
      lastVerifiedAt: Date.now(),
      createdAt: Date.now(),
      metadata: {},
    },
  };
}

describe("IntegrityGuard", () => {
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

  it("passes validation for a normal write", () => {
    const guard = new IntegrityGuard(store);
    const result = guard.validate(makeEpisodic("normal memory write"));
    expect(result.valid).toBe(true);
    expect(result.blockedReason).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  describe("write rate limiting", () => {
    it("warns then blocks on high write volume", () => {
      // Use very small window and low limit
      const guard = new IntegrityGuard(store, {
        maxWritesPerWindow: 3,
        windowMs: 5000,
      });

      // First 3 writes should pass cleanly
      for (let i = 0; i < 3; i++) {
        const r = guard.validate(makeEpisodic(`write ${i}`));
        expect(r.valid).toBe(true);
        expect(r.warnings).toHaveLength(0);
      }

      // Writes 4-6 should produce a warning but still be valid
      let sawWarning = false;
      for (let i = 3; i < 6; i++) {
        const r = guard.validate(makeEpisodic(`write ${i}`));
        expect(r.valid).toBe(true);
        if (r.warnings.length > 0) sawWarning = true;
      }
      expect(sawWarning).toBe(true);

      // Write 7+ should be blocked (> maxWritesPerWindow * 2 = 6)
      const blocked = guard.validate(makeEpisodic("write 7"));
      expect(blocked.valid).toBe(false);
      expect(blocked.blockedReason).toBeTruthy();
      expect(blocked.blockedReason!).toContain("Write rate exceeded");
    });
  });

  describe("contradiction detection", () => {
    it("warns when new fact contradicts existing semantic memory", () => {
      const guard = new IntegrityGuard(store);

      // Store an existing fact
      store.semantic.store(AGENT, {
        fact: "The server deployment process is not automated",
        topic: "deployment",
        confidence: 0.9,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });

      // Validate a contradicting fact (same topic, negation differs)
      const contradicting = makeSemantic(
        "The server deployment process is fully automated",
        "deployment"
      );

      const result = guard.validate(contradicting);
      // Should see a contradiction warning
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("contradiction"))).toBe(true);
    });
  });

  describe("content validation", () => {
    it("warns on empty episodic content", () => {
      const guard = new IntegrityGuard(store);
      const result = guard.validate(makeEpisodic(""));
      expect(result.warnings).toContain("Empty content in memory write");
    });

    it("warns on very large episodic content", () => {
      const guard = new IntegrityGuard(store);
      const largeContent = "x".repeat(150_000);
      const result = guard.validate(makeEpisodic(largeContent));
      expect(result.warnings.some((w) => w.includes("Unusually large"))).toBe(true);
    });
  });

  describe("quarantine", () => {
    it("quarantines blocked writes and getQuarantined returns them", () => {
      const guard = new IntegrityGuard(store, {
        maxWritesPerWindow: 2,
        windowMs: 5000,
      });

      // Burn through the limit
      for (let i = 0; i < 5; i++) {
        guard.validate(makeEpisodic(`burn ${i}`));
      }

      // This should be blocked and quarantined
      const result = guard.validate(makeEpisodic("quarantined write"));
      expect(result.valid).toBe(false);

      const quarantined = guard.getQuarantined(AGENT);
      expect(quarantined.length).toBeGreaterThanOrEqual(1);
      expect(quarantined.some((q) => q.reason.includes("Write rate exceeded"))).toBe(true);
    });

    it("releaseFromQuarantine removes the entry", () => {
      const guard = new IntegrityGuard(store, {
        maxWritesPerWindow: 2,
        windowMs: 5000,
      });

      // Trigger quarantine
      for (let i = 0; i < 5; i++) {
        guard.validate(makeEpisodic(`fill ${i}`));
      }
      guard.validate(makeEpisodic("to-be-released"));

      const quarantined = guard.getQuarantined(AGENT);
      expect(quarantined.length).toBeGreaterThanOrEqual(1);

      const id = quarantined[0].id;
      const released = guard.releaseFromQuarantine(id);
      expect(released).toBe(true);

      // Should no longer appear
      const remaining = guard.getQuarantined(AGENT);
      expect(remaining.find((q) => q.id === id)).toBeUndefined();
    });
  });
});
