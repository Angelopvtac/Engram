import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MemoryStore } from "../src/store/index.js";
import { createApiServer } from "../src/api/index.js";
import type { FastifyInstance } from "fastify";

const AGENT = "test-agent";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

describe("REST API", () => {
  let dbPath: string;
  let store: MemoryStore;
  let app: FastifyInstance;

  beforeEach(async () => {
    dbPath = tmpDb();
    store = new MemoryStore(dbPath);
    app = await createApiServer({ store });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    try { store.close(); } catch {}
    try { fs.unlinkSync(dbPath); } catch {}
  });

  // ── Health ──────────────────────────────────────────────────────────

  describe("GET /api/v1/health", () => {
    it("returns 200 with status ok", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeTypeOf("number");
    });
  });

  // ── Store ───────────────────────────────────────────────────────────

  describe("POST /api/v1/store", () => {
    it("stores working memory", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: { tier: "working", agentId: AGENT, key: "task", value: "testing" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stored).toBe(true);
      expect(body.tier).toBe("working");
      expect(body.key).toBe("task");
    });

    it("stores episodic memory", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: {
          tier: "episodic",
          agentId: AGENT,
          who: "tester",
          what: "ran API tests",
          context: "CI",
          outcome: "passed",
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stored).toBe(true);
      expect(body.tier).toBe("episodic");
      expect(body.id).toBeTruthy();
    });

    it("stores semantic memory", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: {
          tier: "semantic",
          agentId: AGENT,
          fact: "REST APIs use HTTP verbs",
          topic: "web",
          confidence: 0.95,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stored).toBe(true);
      expect(body.tier).toBe("semantic");
      expect(body.id).toBeTruthy();
    });

    it("returns 400 for working memory without key/value", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: { tier: "working", agentId: AGENT },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("key and value");
    });

    it("returns 400 for invalid tier", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: { tier: "invalid", agentId: AGENT },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Recall ──────────────────────────────────────────────────────────

  describe("POST /api/v1/recall", () => {
    it("recalls stored memories", async () => {
      // Seed some data
      await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: {
          tier: "episodic",
          agentId: AGENT,
          who: "dev",
          what: "implemented search feature",
          context: "sprint 5",
          outcome: "deployed",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/recall",
        payload: { query: "search feature", agentId: AGENT },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.memories).toBeDefined();
      expect(body.memories.length).toBeGreaterThan(0);
      expect(body.query).toBe("search feature");
    });

    it("returns empty for non-matching query", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/recall",
        payload: { query: "xyznonexistent123", agentId: AGENT },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().memories).toHaveLength(0);
    });

    it("supports tier filtering", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: {
          tier: "semantic",
          agentId: AGENT,
          fact: "filtering works",
          topic: "testing",
          confidence: 0.9,
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/recall",
        payload: { query: "filtering", agentId: AGENT, tiers: ["semantic"] },
      });
      const body = res.json();
      for (const m of body.memories) {
        expect(m.tier).toBe("semantic");
      }
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────

  describe("GET /api/v1/stats", () => {
    it("returns stats object", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/stats" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.working).toBeDefined();
      expect(body.episodic).toBeDefined();
      expect(body.semantic).toBeDefined();
    });

    it("reflects stored data counts", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: { tier: "working", agentId: AGENT, key: "k1", value: "v1" },
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: { tier: "episodic", agentId: AGENT, what: "test event" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/stats?agentId=${AGENT}`,
      });
      const body = res.json();
      expect(body.working.count).toBe(1);
      expect(body.episodic.count).toBe(1);
    });
  });

  // ── Working Memory CRUD ─────────────────────────────────────────────

  describe("Working memory endpoints", () => {
    it("PUT then GET working memory", async () => {
      const putRes = await app.inject({
        method: "PUT",
        url: `/api/v1/working/${AGENT}/greeting`,
        payload: { value: "hello" },
      });
      expect(putRes.statusCode).toBe(200);
      expect(putRes.json().stored).toBe(true);

      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/working/${AGENT}/greeting`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().value).toBe("hello");
    });

    it("GET returns 404 for non-existent key", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/working/${AGENT}/nonexistent`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
    });

    it("DELETE working memory", async () => {
      await app.inject({
        method: "PUT",
        url: `/api/v1/working/${AGENT}/temp`,
        payload: { value: "gone soon" },
      });

      const delRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/working/${AGENT}/temp`,
      });
      expect(delRes.statusCode).toBe(200);
      expect(delRes.json().deleted).toBe(true);

      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/working/${AGENT}/temp`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it("DELETE returns deleted:false for non-existent key", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/working/${AGENT}/ghost`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(false);
    });

    it("GET list returns all entries for agent", async () => {
      await app.inject({
        method: "PUT",
        url: `/api/v1/working/${AGENT}/a`,
        payload: { value: "1" },
      });
      await app.inject({
        method: "PUT",
        url: `/api/v1/working/${AGENT}/b`,
        payload: { value: "2" },
      });
      await app.inject({
        method: "PUT",
        url: `/api/v1/working/other-agent/c`,
        payload: { value: "3" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/working/${AGENT}`,
      });
      expect(res.statusCode).toBe(200);
      const entries = res.json();
      expect(entries).toHaveLength(2);
    });

    it("GET list returns empty array for agent with no entries", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/working/no-entries-agent`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(0);
    });

    it("PUT with custom TTL", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/working/${AGENT}/ttl-test`,
        payload: { value: "expires fast", ttlMs: 1000 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().stored).toBe(true);
    });
  });

  // ── Share / Revoke ──────────────────────────────────────────────────

  describe("POST /api/v1/share and /api/v1/revoke", () => {
    it("share an episodic memory", async () => {
      // Create an episode first
      const storeRes = await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: {
          tier: "episodic",
          agentId: AGENT,
          what: "shared event",
        },
      });
      const { id } = storeRes.json();

      const shareRes = await app.inject({
        method: "POST",
        url: "/api/v1/share",
        payload: { memoryId: id, tier: "episodic", visibility: "team" },
      });
      expect(shareRes.statusCode).toBe(200);
      expect(shareRes.json().success).toBe(true);
    });

    it("revoke sharing", async () => {
      const storeRes = await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: {
          tier: "episodic",
          agentId: AGENT,
          what: "revoke test",
        },
      });
      const { id } = storeRes.json();

      // Share first
      await app.inject({
        method: "POST",
        url: "/api/v1/share",
        payload: { memoryId: id, tier: "episodic", visibility: "public" },
      });

      // Revoke
      const revokeRes = await app.inject({
        method: "POST",
        url: "/api/v1/revoke",
        payload: { memoryId: id, tier: "episodic" },
      });
      expect(revokeRes.statusCode).toBe(200);
      expect(revokeRes.json().success).toBe(true);
    });
  });

  // ── Forget ──────────────────────────────────────────────────────────

  describe("POST /api/v1/forget", () => {
    it("executes a forgetting policy", async () => {
      // Store some low-confidence data
      await app.inject({
        method: "POST",
        url: "/api/v1/store",
        payload: {
          tier: "semantic",
          agentId: AGENT,
          fact: "uncertain fact",
          topic: "testing",
          confidence: 0.1,
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/forget",
        payload: {
          policyName: "cleanup-low-confidence",
          policyType: "confidence_based",
          agentId: AGENT,
          confidenceThreshold: 0.5,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toBeDefined();
    });
  });
});
