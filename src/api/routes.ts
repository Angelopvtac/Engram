/**
 * Engram REST API route definitions.
 */

import type { FastifyInstance } from "fastify";
import type { MemoryStore } from "../store/index.js";
import type { RecallEngine } from "../recall/index.js";
import type { ForgettingEngine } from "../forgetting/index.js";
import type { SharingManager } from "../sharing/index.js";
import type {
  MemoryTier,
  SharingVisibility,
  ForgettingPolicy,
} from "../types.js";

interface RouteDeps {
  store: MemoryStore;
  recall: RecallEngine;
  forgetting: ForgettingEngine;
  sharing: SharingManager;
}

/** Max string length for memory content fields (100KB) */
const MAX_CONTENT_LEN = 100_000;
/** Max string length for short fields like keys, agent IDs, topics */
const MAX_SHORT_LEN = 1_000;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { store, recall, forgetting, sharing } = deps;

  // Health check
  app.get("/api/v1/health", {
    schema: {
      tags: ["health"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            timestamp: { type: "number" },
          },
        },
      },
    },
  }, async () => ({
    status: "ok",
    timestamp: Date.now(),
  }));

  // Store a memory
  app.post<{
    Body: {
      tier: MemoryTier;
      agentId: string;
      key?: string;
      value?: string;
      ttlMs?: number;
      who?: string;
      what?: string;
      context?: string;
      outcome?: string;
      fact?: string;
      topic?: string;
      confidence?: number;
      visibility?: SharingVisibility;
    };
  }>("/api/v1/store", {
    schema: {
      tags: ["memory"],
      body: {
        type: "object",
        required: ["tier", "agentId"],
        properties: {
          tier: { type: "string", enum: ["working", "episodic", "semantic"] },
          agentId: { type: "string", maxLength: MAX_SHORT_LEN },
          key: { type: "string", maxLength: MAX_SHORT_LEN },
          value: { type: "string", maxLength: MAX_CONTENT_LEN },
          ttlMs: { type: "number" },
          who: { type: "string", maxLength: MAX_SHORT_LEN },
          what: { type: "string", maxLength: MAX_CONTENT_LEN },
          context: { type: "string", maxLength: MAX_CONTENT_LEN },
          outcome: { type: "string", maxLength: MAX_CONTENT_LEN },
          fact: { type: "string", maxLength: MAX_CONTENT_LEN },
          topic: { type: "string", maxLength: MAX_SHORT_LEN },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          visibility: { type: "string", enum: ["private", "team", "public"] },
        },
      },
    },
  }, async (req, reply) => {
    const { tier, agentId } = req.body;

    if (tier === "working") {
      if (!req.body.key || !req.body.value) {
        return reply.status(400).send({ error: "key and value are required for working memory" });
      }
      store.working.set(agentId, req.body.key, req.body.value, req.body.ttlMs ?? 300_000);
      return { stored: true, tier: "working", key: req.body.key };
    }

    if (tier === "episodic") {
      const episode = store.episodic.store(agentId, {
        who: req.body.who || agentId,
        what: req.body.what || "",
        context: req.body.context || "",
        outcome: req.body.outcome || "",
        timestamp: Date.now(),
        visibility: req.body.visibility || "private",
        expiresAt: null,
        metadata: {},
      });
      return { stored: true, tier: "episodic", id: episode.id };
    }

    if (tier === "semantic") {
      const fact = store.semantic.store(agentId, {
        fact: req.body.fact || "",
        topic: req.body.topic || "general",
        confidence: req.body.confidence ?? 1.0,
        sourceEpisodeIds: [],
        visibility: req.body.visibility || "private",
        metadata: {},
      });
      return { stored: true, tier: "semantic", id: fact.id };
    }

    return reply.status(400).send({ error: `Invalid tier: ${tier}` });
  });

  // Recall memories
  app.post<{
    Body: {
      query: string;
      agentId?: string;
      tiers?: MemoryTier[];
      maxResults?: number;
      minConfidence?: number;
      maxTokens?: number;
    };
  }>("/api/v1/recall", {
    schema: {
      tags: ["memory"],
      body: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", maxLength: MAX_CONTENT_LEN },
          agentId: { type: "string", maxLength: MAX_SHORT_LEN },
          tiers: { type: "array", items: { type: "string", enum: ["working", "episodic", "semantic"] } },
          maxResults: { type: "number" },
          minConfidence: { type: "number" },
          maxTokens: { type: "number" },
        },
      },
    },
  }, async (req) => {
    return recall.recallAsync(req.body.query, {
      agentId: req.body.agentId,
      tiers: req.body.tiers,
      maxResults: req.body.maxResults,
      minConfidence: req.body.minConfidence,
      maxTokens: req.body.maxTokens,
    });
  });

  // Forget memories
  app.post<{
    Body: {
      policyName: string;
      policyType: ForgettingPolicy["type"];
      agentId?: string;
      target?: string;
      confidenceThreshold?: number;
      inactiveDays?: number;
    };
  }>("/api/v1/forget", {
    schema: {
      tags: ["memory"],
      body: {
        type: "object",
        required: ["policyName", "policyType"],
        properties: {
          policyName: { type: "string" },
          policyType: { type: "string", enum: ["time_based", "confidence_based", "access_based", "explicit", "gdpr"] },
          agentId: { type: "string" },
          target: { type: "string" },
          confidenceThreshold: { type: "number" },
          inactiveDays: { type: "number" },
        },
      },
    },
  }, async (req) => {
    const policy: ForgettingPolicy = {
      name: req.body.policyName,
      type: req.body.policyType,
      target: req.body.target,
      confidenceThreshold: req.body.confidenceThreshold,
      inactiveDays: req.body.inactiveDays,
    };
    return forgetting.execute(policy, req.body.agentId);
  });

  // Statistics
  app.get<{
    Querystring: { agentId?: string };
  }>("/api/v1/stats", {
    schema: {
      tags: ["memory"],
      querystring: {
        type: "object",
        properties: {
          agentId: { type: "string" },
        },
      },
    },
  }, async (req) => {
    return store.stats(req.query.agentId);
  });

  // Share a memory
  app.post<{
    Body: {
      memoryId: string;
      tier: MemoryTier;
      visibility: SharingVisibility;
    };
  }>("/api/v1/share", {
    schema: {
      tags: ["sharing"],
      body: {
        type: "object",
        required: ["memoryId", "tier", "visibility"],
        properties: {
          memoryId: { type: "string" },
          tier: { type: "string", enum: ["episodic", "semantic"] },
          visibility: { type: "string", enum: ["private", "team", "public"] },
        },
      },
    },
  }, async (req) => {
    const success = sharing.share(req.body.memoryId, req.body.tier, req.body.visibility);
    return { success };
  });

  // Revoke sharing
  app.post<{
    Body: {
      memoryId: string;
      tier: MemoryTier;
    };
  }>("/api/v1/revoke", {
    schema: {
      tags: ["sharing"],
      body: {
        type: "object",
        required: ["memoryId", "tier"],
        properties: {
          memoryId: { type: "string" },
          tier: { type: "string", enum: ["episodic", "semantic"] },
        },
      },
    },
  }, async (req) => {
    const success = sharing.revoke(req.body.memoryId, req.body.tier);
    return { success };
  });

  // Working memory - list
  app.get<{
    Params: { agentId: string };
  }>("/api/v1/working/:agentId", {
    schema: {
      tags: ["working"],
      params: {
        type: "object",
        required: ["agentId"],
        properties: { agentId: { type: "string" } },
      },
    },
  }, async (req) => {
    return store.working.list(req.params.agentId);
  });

  // Working memory - get
  app.get<{
    Params: { agentId: string; key: string };
  }>("/api/v1/working/:agentId/:key", {
    schema: {
      tags: ["working"],
      params: {
        type: "object",
        required: ["agentId", "key"],
        properties: {
          agentId: { type: "string" },
          key: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    const entry = store.working.get(req.params.agentId, req.params.key);
    if (!entry) {
      return reply.status(404).send({ error: "Not found" });
    }
    return entry;
  });

  // Working memory - set
  app.put<{
    Params: { agentId: string; key: string };
    Body: { value: string; ttlMs?: number };
  }>("/api/v1/working/:agentId/:key", {
    schema: {
      tags: ["working"],
      params: {
        type: "object",
        required: ["agentId", "key"],
        properties: {
          agentId: { type: "string" },
          key: { type: "string" },
        },
      },
      body: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string", maxLength: MAX_CONTENT_LEN },
          ttlMs: { type: "number" },
        },
      },
    },
  }, async (req) => {
    store.working.set(req.params.agentId, req.params.key, req.body.value, req.body.ttlMs ?? 300_000);
    return { stored: true };
  });

  // Working memory - delete
  app.delete<{
    Params: { agentId: string; key: string };
  }>("/api/v1/working/:agentId/:key", {
    schema: {
      tags: ["working"],
      params: {
        type: "object",
        required: ["agentId", "key"],
        properties: {
          agentId: { type: "string" },
          key: { type: "string" },
        },
      },
    },
  }, async (req) => {
    const deleted = store.working.delete(req.params.agentId, req.params.key);
    return { deleted };
  });
}
