#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { MemoryStore } from "./store/index.js";
import { RecallEngine } from "./recall/index.js";
import { ForgettingEngine } from "./forgetting/index.js";
import { SharingManager } from "./sharing/index.js";
import type { ForgettingPolicy, MemoryTier } from "./types.js";

const DEFAULT_DB = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".engram"),
  "memory.db"
);

function getStore(dbPath?: string): MemoryStore {
  const p = dbPath ?? DEFAULT_DB;
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return new MemoryStore(p);
}

const program = new Command();

program
  .name("engram")
  .description("Production agent memory infrastructure")
  .version("0.1.0")
  .option("--db <path>", "Path to SQLite database", DEFAULT_DB)
  .option("--agent <id>", "Agent ID", "default");

program
  .command("init")
  .description("Initialize a memory store for an agent or team")
  .option("--team <id>", "Team ID to associate with")
  .action((opts) => {
    const { db, agent } = program.opts();
    let store: MemoryStore | undefined;
    try {
      store = getStore(db);
      if (opts.team) {
        const sharing = new SharingManager(store);
        sharing.configure({
          agentId: agent,
          teamId: opts.team,
          defaultVisibility: { episodic: "private", semantic: "private" },
        });
        console.log(`Initialized memory store for agent "${agent}" in team "${opts.team}"`);
      } else {
        console.log(`Initialized memory store for agent "${agent}"`);
      }
      console.log(`Database: ${db ?? DEFAULT_DB}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      store?.close();
    }
  });

program
  .command("store <tier> <content>")
  .description("Store a memory in the specified tier (working, episodic, semantic)")
  .option("--key <key>", "Key for working memory")
  .option("--ttl <ms>", "TTL in milliseconds for working memory", "300000")
  .option("--who <who>", "Who was involved (episodic)", "system")
  .option("--context <ctx>", "Context (episodic)", "")
  .option("--outcome <outcome>", "Outcome (episodic)", "")
  .option("--topic <topic>", "Topic (semantic)", "general")
  .option("--confidence <n>", "Confidence score 0-1 (semantic)", "1.0")
  .option("--visibility <v>", "Visibility: private, team, public", "private")
  .action((tier: string, content: string, opts) => {
    const validTiers = ["working", "episodic", "semantic"];
    if (!validTiers.includes(tier)) {
      console.error(`Error: Invalid tier "${tier}". Must be one of: ${validTiers.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const validVisibilities = ["private", "team", "public"];
    if (opts.visibility && !validVisibilities.includes(opts.visibility)) {
      console.error(`Error: Invalid visibility "${opts.visibility}". Must be one of: ${validVisibilities.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    if (tier === "semantic") {
      const conf = parseFloat(opts.confidence);
      if (isNaN(conf) || conf < 0 || conf > 1) {
        console.error(`Error: Confidence must be a number between 0 and 1, got "${opts.confidence}"`);
        process.exitCode = 1;
        return;
      }
    }

    const { db, agent } = program.opts();
    let store: MemoryStore | undefined;
    try {
      store = getStore(db);

      switch (tier as MemoryTier) {
        case "working": {
          const key = opts.key ?? `wm-${Date.now()}`;
          store.working.set(agent, key, content, parseInt(opts.ttl, 10));
          console.log(`Stored working memory: ${key}`);
          break;
        }
        case "episodic": {
          const ep = store.episodic.store(agent, {
            who: opts.who,
            what: content,
            context: opts.context,
            outcome: opts.outcome,
            timestamp: Date.now(),
            visibility: opts.visibility,
            expiresAt: null,
            metadata: {},
          });
          console.log(`Stored episode: ${ep.id}`);
          break;
        }
        case "semantic": {
          const fact = store.semantic.store(agent, {
            fact: content,
            topic: opts.topic,
            confidence: parseFloat(opts.confidence),
            sourceEpisodeIds: [],
            visibility: opts.visibility,
            metadata: {},
          });
          console.log(`Stored semantic fact: ${fact.id}`);
          break;
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      store?.close();
    }
  });

program
  .command("recall <query>")
  .description("Search memories using natural language query")
  .option("--tiers <tiers>", "Comma-separated tiers to search", "working,episodic,semantic")
  .option("--max-results <n>", "Maximum results", "10")
  .option("--max-tokens <n>", "Maximum token budget")
  .option("--min-confidence <n>", "Minimum confidence for semantic memories")
  .action((query: string, opts) => {
    const validTiers = ["working", "episodic", "semantic"];
    const requestedTiers = opts.tiers.split(",") as MemoryTier[];
    for (const t of requestedTiers) {
      if (!validTiers.includes(t)) {
        console.error(`Error: Invalid tier "${t}". Must be one of: ${validTiers.join(", ")}`);
        process.exitCode = 1;
        return;
      }
    }

    const { db, agent } = program.opts();
    let store: MemoryStore | undefined;
    try {
      store = getStore(db);
      const engine = new RecallEngine(store);

      const result = engine.recall(query, {
        tiers: requestedTiers,
        agentId: agent,
        maxResults: parseInt(opts.maxResults, 10),
        maxTokens: opts.maxTokens ? parseInt(opts.maxTokens, 10) : undefined,
        minConfidence: opts.minConfidence ? parseFloat(opts.minConfidence) : undefined,
      });

      console.log(`\nRecall results for: "${query}"`);
      console.log(`Found ${result.memories.length} memories (~${result.totalTokens} tokens)\n`);

      for (const mem of result.memories) {
        switch (mem.tier) {
          case "working":
            console.log(`  [WORKING] ${mem.data.key} = ${mem.data.value}`);
            break;
          case "episodic":
            console.log(`  [EPISODIC] ${mem.data.id.slice(0, 8)} | ${mem.data.who}: ${mem.data.what}`);
            if (mem.data.outcome) console.log(`             outcome: ${mem.data.outcome}`);
            break;
          case "semantic":
            console.log(`  [SEMANTIC] ${mem.data.id.slice(0, 8)} | [${mem.data.topic}] ${mem.data.fact} (confidence: ${mem.data.confidence})`);
            break;
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      store?.close();
    }
  });

program
  .command("forget")
  .description("Run forgetting policies")
  .option("--policy <type>", "Policy type: time_based, confidence_based, access_based, explicit, gdpr")
  .option("--ttl-working <ms>", "Working memory TTL (time_based)")
  .option("--ttl-episodic <ms>", "Episodic memory TTL (time_based)")
  .option("--ttl-semantic <ms>", "Semantic memory TTL (time_based)")
  .option("--confidence-threshold <n>", "Confidence threshold (confidence_based)", "0.3")
  .option("--inactive-days <n>", "Days of inactivity (access_based)", "30")
  .option("--target <entity>", "Target entity/topic (explicit, gdpr)")
  .action((opts) => {
    if (!opts.policy) {
      console.error("Error: Please specify a --policy type");
      process.exitCode = 1;
      return;
    }

    const validPolicies = ["time_based", "confidence_based", "access_based", "explicit", "gdpr"];
    if (!validPolicies.includes(opts.policy)) {
      console.error(`Error: Invalid policy "${opts.policy}". Must be one of: ${validPolicies.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const { db, agent } = program.opts();
    let store: MemoryStore | undefined;
    try {
      store = getStore(db);
      const engine = new ForgettingEngine(store);

      const policy: ForgettingPolicy = {
        name: `cli-${opts.policy}`,
        type: opts.policy,
        ttl: {
          working: opts.ttlWorking ? parseInt(opts.ttlWorking, 10) : undefined,
          episodic: opts.ttlEpisodic ? parseInt(opts.ttlEpisodic, 10) : undefined,
          semantic: opts.ttlSemantic ? parseInt(opts.ttlSemantic, 10) : undefined,
        },
        confidenceThreshold: parseFloat(opts.confidenceThreshold),
        inactiveDays: parseInt(opts.inactiveDays, 10),
        target: opts.target,
      };

      const report = engine.execute(policy, agent);

      console.log(`\nForgetting Report: ${report.policy}`);
      console.log(`  Deleted: ${report.deleted}`);
      console.log(`  Demoted: ${report.demoted}`);
      console.log(`  Retained: ${report.retained}`);

      if (report.reasons.length > 0) {
        console.log("\n  Details:");
        for (const r of report.reasons) {
          console.log(`    [${r.tier}] ${r.memoryId.slice(0, 8)} — ${r.action}: ${r.reason}`);
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      store?.close();
    }
  });

program
  .command("stats")
  .description("Show memory usage statistics")
  .action(() => {
    const { db, agent } = program.opts();
    let store: MemoryStore | undefined;
    try {
      store = getStore(db);
      const s = store.stats(agent);

      console.log(`\nMemory Stats for agent "${agent}"`);
      console.log(`${"─".repeat(40)}`);
      console.log(`  Working:     ${s.working.count} entries (${s.working.totalSize} bytes)`);
      console.log(`  Episodic:    ${s.episodic.count} episodes (${s.episodic.totalSize} bytes, avg age: ${Math.round(s.episodic.avgAge / 1000)}s)`);
      console.log(`  Semantic:    ${s.semantic.count} facts (${s.semantic.totalSize} bytes, avg confidence: ${s.semantic.avgConfidence.toFixed(2)})`);
      console.log(`  Quarantined: ${s.quarantined}`);
      console.log(`  Audit log:   ${s.auditEntries} entries`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      store?.close();
    }
  });

program.parse();
