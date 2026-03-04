import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MemoryStore } from "../src/store/index.js";
import { SharingManager } from "../src/sharing/index.js";

const AGENT = "test-agent";

function tmpDb(): string {
  return path.join(os.tmpdir(), `engram-test-${crypto.randomUUID()}.db`);
}

describe("SharingManager", () => {
  let dbPath: string;
  let store: MemoryStore;
  let sharing: SharingManager;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new MemoryStore(dbPath);
    sharing = new SharingManager(store);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it("configure and getConfig round-trip", () => {
    sharing.configure({
      agentId: AGENT,
      teamId: "team-alpha",
      defaultVisibility: {
        episodic: "team",
        semantic: "private",
      },
    });

    const config = sharing.getConfig(AGENT);
    expect(config).not.toBeNull();
    expect(config!.agentId).toBe(AGENT);
    expect(config!.teamId).toBe("team-alpha");
    expect(config!.defaultVisibility.episodic).toBe("team");
    expect(config!.defaultVisibility.semantic).toBe("private");
    expect(config!.defaultVisibility.working).toBe("private");
  });

  it("getConfig returns null for unconfigured agent", () => {
    expect(sharing.getConfig("unknown-agent")).toBeNull();
  });

  it("share episodic memory changes visibility", () => {
    const ep = store.episodic.store(AGENT, {
      who: "user",
      what: "shareable episode",
      context: "",
      outcome: "",
      timestamp: Date.now(),
      visibility: "private",
      expiresAt: null,
      metadata: {},
    });

    expect(ep.visibility).toBe("private");

    const result = sharing.share(ep.id, "episodic", "team");
    expect(result).toBe(true);

    const updated = store.episodic.get(ep.id);
    expect(updated!.visibility).toBe("team");
  });

  it("share semantic memory changes visibility", () => {
    const fact = store.semantic.store(AGENT, {
      fact: "shareable knowledge",
      topic: "sharing",
      confidence: 0.9,
      sourceEpisodeIds: [],
      visibility: "private",
      metadata: {},
    });

    const result = sharing.share(fact.id, "semantic", "public");
    expect(result).toBe(true);

    const updated = store.semantic.get(fact.id);
    expect(updated!.visibility).toBe("public");
  });

  it("share working memory returns false (always private)", () => {
    store.working.set(AGENT, "secret", "classified", 60_000);
    const result = sharing.share("secret", "working", "team");
    expect(result).toBe(false);
  });

  it("share returns false for non-existent memory", () => {
    const result = sharing.share("non-existent-id", "episodic", "team");
    expect(result).toBe(false);
  });

  it("revoke sets visibility back to private", () => {
    const ep = store.episodic.store(AGENT, {
      who: "user",
      what: "was shared",
      context: "",
      outcome: "",
      timestamp: Date.now(),
      visibility: "team",
      expiresAt: null,
      metadata: {},
    });

    const revoked = sharing.revoke(ep.id, "episodic");
    expect(revoked).toBe(true);

    const updated = store.episodic.get(ep.id);
    expect(updated!.visibility).toBe("private");
  });

  it("revoke working memory returns false", () => {
    expect(sharing.revoke("any-key", "working")).toBe(false);
  });

  describe("getTeamMemories", () => {
    it("returns shared memories from agents in the same team", () => {
      // Configure two agents in the same team
      sharing.configure({
        agentId: "agent-a",
        teamId: "team-red",
        defaultVisibility: { episodic: "team", semantic: "team" },
      });
      sharing.configure({
        agentId: "agent-b",
        teamId: "team-red",
        defaultVisibility: { episodic: "team", semantic: "team" },
      });

      // Agent A shares an episode and a fact
      const ep = store.episodic.store("agent-a", {
        who: "agent-a",
        what: "team-shared episode from A",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      sharing.share(ep.id, "episodic", "team");

      const fact = store.semantic.store("agent-a", {
        fact: "team-shared fact from A",
        topic: "collaboration",
        confidence: 0.85,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      sharing.share(fact.id, "semantic", "team");

      // Agent B shares an episode
      const epB = store.episodic.store("agent-b", {
        who: "agent-b",
        what: "team-shared episode from B",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      sharing.share(epB.id, "episodic", "team");

      // A private episode from agent-a should NOT appear
      store.episodic.store("agent-a", {
        who: "agent-a",
        what: "private episode from A",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      const team = sharing.getTeamMemories("team-red");
      expect(team.episodic).toHaveLength(2);
      expect(team.semantic).toHaveLength(1);
      expect(team.episodic.every((e) => e.visibility === "team" || e.visibility === "public")).toBe(true);
    });

    it("returns empty for unknown team", () => {
      const team = sharing.getTeamMemories("team-nonexistent");
      expect(team.episodic).toHaveLength(0);
      expect(team.semantic).toHaveLength(0);
    });
  });

  describe("getPublicMemories", () => {
    it("returns only publicly visible memories", () => {
      const ep = store.episodic.store(AGENT, {
        who: "user",
        what: "public announcement",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });
      sharing.share(ep.id, "episodic", "public");

      const fact = store.semantic.store(AGENT, {
        fact: "publicly known principle",
        topic: "public knowledge",
        confidence: 1.0,
        sourceEpisodeIds: [],
        visibility: "private",
        metadata: {},
      });
      sharing.share(fact.id, "semantic", "public");

      // This one stays private
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

      const pub = sharing.getPublicMemories();
      expect(pub.episodic).toHaveLength(1);
      expect(pub.episodic[0].what).toBe("public announcement");
      expect(pub.semantic).toHaveLength(1);
      expect(pub.semantic[0].fact).toBe("publicly known principle");
    });

    it("returns empty when nothing is public", () => {
      store.episodic.store(AGENT, {
        who: "user",
        what: "secret",
        context: "",
        outcome: "",
        timestamp: Date.now(),
        visibility: "private",
        expiresAt: null,
        metadata: {},
      });

      const pub = sharing.getPublicMemories();
      expect(pub.episodic).toHaveLength(0);
      expect(pub.semantic).toHaveLength(0);
    });
  });
});
