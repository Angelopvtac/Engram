/**
 * MCP (Model Context Protocol) server for Engram memory operations.
 *
 * Exposes all memory operations as MCP tools that can be used by
 * any MCP-compatible client (Claude Code, etc.).
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { MemoryStore } from "../store/index.js";
import { RecallEngine } from "../recall/index.js";
import { ForgettingEngine } from "../forgetting/index.js";
import { SharingManager } from "../sharing/index.js";
import type {
  MemoryTier,
  SharingVisibility,
  ForgettingPolicy,
} from "../types.js";

export interface McpServerOptions {
  store: MemoryStore;
  recallEngine?: RecallEngine;
  forgettingEngine?: ForgettingEngine;
  sharingManager?: SharingManager;
}

export function createMcpServer(opts: McpServerOptions): Server {
  const { store } = opts;
  const recall = opts.recallEngine ?? new RecallEngine(store);
  const forgetting = opts.forgettingEngine ?? new ForgettingEngine(store);
  const sharing = opts.sharingManager ?? new SharingManager(store);

  const server = new Server(
    { name: "engram", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const toolDefs = [
    {
      name: "engram_store",
      description: "Store a memory (working, episodic, or semantic)",
      inputSchema: {
        type: "object" as const,
        properties: {
          tier: { type: "string", enum: ["working", "episodic", "semantic"], description: "Memory tier" },
          agentId: { type: "string", description: "Agent identifier" },
          key: { type: "string", description: "Key (working memory only)" },
          value: { type: "string", description: "Value (working memory only)" },
          ttlMs: { type: "number", description: "TTL in ms (working, default: 300000)" },
          who: { type: "string", description: "Who (episodic)" },
          what: { type: "string", description: "What happened (episodic)" },
          context: { type: "string", description: "Context (episodic)" },
          outcome: { type: "string", description: "Outcome (episodic)" },
          fact: { type: "string", description: "The fact (semantic)" },
          topic: { type: "string", description: "Topic (semantic)" },
          confidence: { type: "number", description: "Confidence 0-1 (semantic)" },
          visibility: { type: "string", enum: ["private", "team", "public"] },
        },
        required: ["tier", "agentId"],
      },
    },
    {
      name: "engram_recall",
      description: "Recall memories by natural language query",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
          agentId: { type: "string", description: "Filter by agent" },
          tiers: { type: "array", items: { type: "string", enum: ["working", "episodic", "semantic"] } },
          maxResults: { type: "number", description: "Max results (default: 20)" },
          minConfidence: { type: "number", description: "Min confidence for semantic" },
        },
        required: ["query"],
      },
    },
    {
      name: "engram_forget",
      description: "Run a forgetting policy",
      inputSchema: {
        type: "object" as const,
        properties: {
          policyName: { type: "string" },
          policyType: { type: "string", enum: ["time_based", "confidence_based", "access_based", "explicit", "gdpr"] },
          agentId: { type: "string" },
          target: { type: "string" },
          confidenceThreshold: { type: "number" },
          inactiveDays: { type: "number" },
        },
        required: ["policyName", "policyType"],
      },
    },
    {
      name: "engram_stats",
      description: "Get memory statistics",
      inputSchema: {
        type: "object" as const,
        properties: { agentId: { type: "string" } },
      },
    },
    {
      name: "engram_share",
      description: "Share a memory",
      inputSchema: {
        type: "object" as const,
        properties: {
          memoryId: { type: "string" },
          tier: { type: "string", enum: ["episodic", "semantic"] },
          visibility: { type: "string", enum: ["private", "team", "public"] },
        },
        required: ["memoryId", "tier", "visibility"],
      },
    },
    {
      name: "engram_working_get",
      description: "Get a working memory entry",
      inputSchema: {
        type: "object" as const,
        properties: { agentId: { type: "string" }, key: { type: "string" } },
        required: ["agentId", "key"],
      },
    },
    {
      name: "engram_working_set",
      description: "Set a working memory entry",
      inputSchema: {
        type: "object" as const,
        properties: {
          agentId: { type: "string" },
          key: { type: "string" },
          value: { type: "string" },
          ttlMs: { type: "number", description: "TTL in ms (default: 300000)" },
        },
        required: ["agentId", "key", "value"],
      },
    },
    {
      name: "engram_working_list",
      description: "List working memory entries",
      inputSchema: {
        type: "object" as const,
        properties: { agentId: { type: "string" } },
        required: ["agentId"],
      },
    },
  ];

  // Register tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefs,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "engram_store":
          return handleStore(store, args);
        case "engram_recall":
          return handleRecall(recall, args);
        case "engram_forget":
          return handleForget(forgetting, args);
        case "engram_stats":
          return handleStats(store, args);
        case "engram_share":
          return handleShare(sharing, args);
        case "engram_working_get":
          return handleWorkingGet(store, args);
        case "engram_working_set":
          return handleWorkingSet(store, args);
        case "engram_working_list":
          return handleWorkingList(store, args);
        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}

function handleStore(store: MemoryStore, args: Record<string, unknown>) {
  const tier = args.tier as MemoryTier;
  const agentId = args.agentId as string;

  if (tier === "working") {
    const key = args.key as string;
    const value = args.value as string;
    const ttlMs = (args.ttlMs as number) ?? 300_000;
    if (!key || !value) {
      return { content: [{ type: "text" as const, text: "key and value required for working memory" }], isError: true };
    }
    store.working.set(agentId, key, value, ttlMs);
    return { content: [{ type: "text" as const, text: JSON.stringify({ stored: true, tier: "working", key }) }] };
  }

  if (tier === "episodic") {
    const episode = store.episodic.store(agentId, {
      who: (args.who as string) || agentId,
      what: (args.what as string) || "",
      context: (args.context as string) || "",
      outcome: (args.outcome as string) || "",
      timestamp: Date.now(),
      visibility: (args.visibility as SharingVisibility) || "private",
      expiresAt: null,
      metadata: {},
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ stored: true, tier: "episodic", id: episode.id }) }] };
  }

  if (tier === "semantic") {
    const fact = store.semantic.store(agentId, {
      fact: (args.fact as string) || "",
      topic: (args.topic as string) || "general",
      confidence: (args.confidence as number) ?? 1.0,
      sourceEpisodeIds: [],
      visibility: (args.visibility as SharingVisibility) || "private",
      metadata: {},
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ stored: true, tier: "semantic", id: fact.id }) }] };
  }

  return { content: [{ type: "text" as const, text: `Invalid tier: ${tier}` }], isError: true };
}

async function handleRecall(recall: RecallEngine, args: Record<string, unknown>) {
  const result = await recall.recallAsync(args.query as string, {
    agentId: args.agentId as string | undefined,
    tiers: args.tiers as MemoryTier[] | undefined,
    maxResults: args.maxResults as number | undefined,
    minConfidence: args.minConfidence as number | undefined,
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function handleForget(forgetting: ForgettingEngine, args: Record<string, unknown>) {
  const policy: ForgettingPolicy = {
    name: args.policyName as string,
    type: args.policyType as ForgettingPolicy["type"],
    target: args.target as string | undefined,
    confidenceThreshold: args.confidenceThreshold as number | undefined,
    inactiveDays: args.inactiveDays as number | undefined,
  };
  const report = forgetting.execute(policy, args.agentId as string | undefined);
  return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
}

function handleStats(store: MemoryStore, args: Record<string, unknown>) {
  const stats = store.stats(args.agentId as string | undefined);
  return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
}

function handleShare(sharing: SharingManager, args: Record<string, unknown>) {
  const success = sharing.share(
    args.memoryId as string,
    args.tier as MemoryTier,
    args.visibility as SharingVisibility
  );
  return { content: [{ type: "text" as const, text: JSON.stringify({ success }) }] };
}

function handleWorkingGet(store: MemoryStore, args: Record<string, unknown>) {
  const entry = store.working.get(args.agentId as string, args.key as string);
  if (!entry) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ found: false }) }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify({ found: true, entry }) }] };
}

function handleWorkingSet(store: MemoryStore, args: Record<string, unknown>) {
  const ttlMs = (args.ttlMs as number) ?? 300_000;
  store.working.set(args.agentId as string, args.key as string, args.value as string, ttlMs);
  return { content: [{ type: "text" as const, text: JSON.stringify({ stored: true }) }] };
}

function handleWorkingList(store: MemoryStore, args: Record<string, unknown>) {
  const entries = store.working.list(args.agentId as string);
  return { content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }] };
}
