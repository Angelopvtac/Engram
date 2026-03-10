import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  LocalEmbeddingProvider,
  OpenAIEmbeddingProvider,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  createEmbeddingProvider,
} from "../src/embeddings/index.js";
import { MemoryStore } from "../src/store/index.js";
import { RecallEngine } from "../src/recall/index.js";

const AGENT = "test-agent";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

describe("LocalEmbeddingProvider", () => {
  let provider: LocalEmbeddingProvider;

  beforeEach(() => {
    provider = new LocalEmbeddingProvider(128);
  });

  it("embed() returns vector of correct dimensions", async () => {
    const vec = await provider.embed("hello world");
    expect(vec).toHaveLength(128);
  });

  it("embed() with custom dimensions", async () => {
    const small = new LocalEmbeddingProvider(32);
    const vec = await small.embed("test");
    expect(vec).toHaveLength(32);
    expect(small.dimensions).toBe(32);
  });

  it("embed() defaults to 128 dimensions", () => {
    const def = new LocalEmbeddingProvider();
    expect(def.dimensions).toBe(128);
  });

  it("embed() returns L2-normalized vector", async () => {
    const vec = await provider.embed("normalize this text");
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it("embed() returns zero vector for empty string", async () => {
    const vec = await provider.embed("");
    expect(vec).toHaveLength(128);
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it("embed() is deterministic", async () => {
    const v1 = await provider.embed("same input");
    const v2 = await provider.embed("same input");
    expect(v1).toEqual(v2);
  });

  it("embedBatch() returns correct number of vectors", async () => {
    const vecs = await provider.embedBatch(["hello", "world", "test"]);
    expect(vecs).toHaveLength(3);
    for (const v of vecs) {
      expect(v).toHaveLength(128);
    }
  });

  it("embedBatch() matches individual embed() calls", async () => {
    const texts = ["alpha", "beta"];
    const batch = await provider.embedBatch(texts);
    const individual = await Promise.all(texts.map((t) => provider.embed(t)));
    expect(batch).toEqual(individual);
  });

  it("embedBatch() handles empty array", async () => {
    const vecs = await provider.embedBatch([]);
    expect(vecs).toHaveLength(0);
  });

  it("similar texts produce higher similarity than dissimilar texts", async () => {
    const v1 = await provider.embed("machine learning algorithms");
    const v2 = await provider.embed("machine learning models");
    const v3 = await provider.embed("cooking pasta recipes");
    const simSimilar = cosineSimilarity(v1, v2);
    const simDissimilar = cosineSimilarity(v1, v3);
    expect(simSimilar).toBeGreaterThan(simDissimilar);
  });
});

describe("cosineSimilarity", () => {
  it("identical vectors return 1.0", () => {
    const v = [0.5, 0.5, 0.5, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it("opposite vectors return -1.0", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 10);
  });

  it("orthogonal vectors return 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10);
  });

  it("returns 0 for mismatched dimensions", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("returns 0 when one vector is zero", () => {
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("handles single-element vectors", () => {
    expect(cosineSimilarity([3], [5])).toBeCloseTo(1.0, 10);
    expect(cosineSimilarity([3], [-5])).toBeCloseTo(-1.0, 10);
  });
});

describe("serializeEmbedding / deserializeEmbedding", () => {
  it("roundtrip preserves values", () => {
    const vec = [0.1, -0.5, 3.14159, 0, -100.123];
    const buf = serializeEmbedding(vec);
    const result = deserializeEmbedding(buf);
    expect(result).toHaveLength(vec.length);
    for (let i = 0; i < vec.length; i++) {
      expect(result[i]).toBeCloseTo(vec[i], 10);
    }
  });

  it("serializes to correct byte size", () => {
    const vec = [1, 2, 3, 4];
    const buf = serializeEmbedding(vec);
    expect(buf.length).toBe(4 * 8); // 8 bytes per double
  });

  it("handles empty vector", () => {
    const buf = serializeEmbedding([]);
    expect(buf.length).toBe(0);
    expect(deserializeEmbedding(buf)).toEqual([]);
  });

  it("preserves negative values", () => {
    const vec = [-1.5, -2.5, -0.001];
    const result = deserializeEmbedding(serializeEmbedding(vec));
    for (let i = 0; i < vec.length; i++) {
      expect(result[i]).toBeCloseTo(vec[i], 10);
    }
  });
});

describe("createEmbeddingProvider", () => {
  it("returns null when no config provided", () => {
    expect(createEmbeddingProvider()).toBeNull();
    expect(createEmbeddingProvider(undefined)).toBeNull();
  });

  it("returns LocalEmbeddingProvider for local config", () => {
    const p = createEmbeddingProvider({ provider: "local" });
    expect(p).toBeInstanceOf(LocalEmbeddingProvider);
    expect(p!.dimensions).toBe(128);
  });

  it("returns LocalEmbeddingProvider with custom dimensions", () => {
    const p = createEmbeddingProvider({ provider: "local", localDimensions: 64 });
    expect(p).toBeInstanceOf(LocalEmbeddingProvider);
    expect(p!.dimensions).toBe(64);
  });

  it("returns null for openai without API key", () => {
    const orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const p = createEmbeddingProvider({ provider: "openai" });
    expect(p).toBeNull();
    if (orig) process.env.OPENAI_API_KEY = orig;
  });

  it("returns OpenAIEmbeddingProvider with explicit API key", () => {
    const p = createEmbeddingProvider({ provider: "openai", apiKey: "sk-test-key" });
    expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(p!.dimensions).toBe(1536);
  });

  it("returns null for unknown provider", () => {
    const p = createEmbeddingProvider({ provider: "unknown" as "local" });
    expect(p).toBeNull();
  });
});

describe("RecallEngine with embeddings", () => {
  let dbPath: string;
  let store: MemoryStore;
  let provider: LocalEmbeddingProvider;
  let recall: RecallEngine;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new MemoryStore(dbPath);
    provider = new LocalEmbeddingProvider(64);
    recall = new RecallEngine(store, { embeddingProvider: provider });
  });

  afterEach(() => {
    try { store.close(); } catch {}
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it("recallAsync returns results using vector search", async () => {
    store.episodic.store(AGENT, {
      who: "developer",
      what: "fixed authentication bug in login handler",
      context: "production incident",
      outcome: "resolved with token refresh",
      timestamp: Date.now(),
      visibility: "private",
      expiresAt: null,
      metadata: {},
    });

    store.semantic.store(AGENT, {
      fact: "JWT tokens expire after 15 minutes",
      topic: "authentication",
      confidence: 0.9,
      sourceEpisodeIds: [],
      visibility: "private",
      metadata: {},
    });

    const result = await recall.recallAsync("authentication login", {
      agentId: AGENT,
    });
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.query).toBe("authentication login");
  });

  it("recallAsync falls back gracefully when no embeddings stored", async () => {
    store.episodic.store(AGENT, {
      who: "user",
      what: "deployed the app",
      context: "staging",
      outcome: "success",
      timestamp: Date.now(),
      visibility: "private",
      expiresAt: null,
      metadata: {},
    });

    const result = await recall.recallAsync("deploy", { agentId: AGENT });
    expect(result.memories.length).toBeGreaterThan(0);
  });

  it("synchronous recall still works with embedding provider configured", () => {
    store.episodic.store(AGENT, {
      who: "user",
      what: "ran database migration",
      context: "production",
      outcome: "success",
      timestamp: Date.now(),
      visibility: "private",
      expiresAt: null,
      metadata: {},
    });

    const result = recall.recall("database migration", { agentId: AGENT });
    expect(result.memories.length).toBeGreaterThan(0);
  });
});
