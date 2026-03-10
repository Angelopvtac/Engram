#!/usr/bin/env node
/**
 * Engram MCP Server entry point.
 * Communicates over stdio transport for MCP clients.
 *
 * Usage:
 *   engram-mcp [--db <path>]
 *
 * Environment:
 *   ENGRAM_DB_PATH — SQLite database path (default: ./engram.db)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "../store/index.js";
import { RecallEngine } from "../recall/index.js";
import { ForgettingEngine } from "../forgetting/index.js";
import { SharingManager } from "../sharing/index.js";
import { createMcpServer } from "./index.js";

const dbPath = process.argv.includes("--db")
  ? process.argv[process.argv.indexOf("--db") + 1]
  : process.env.ENGRAM_DB_PATH ?? "./engram.db";

const store = new MemoryStore(dbPath);
const recallEngine = new RecallEngine(store);
const forgettingEngine = new ForgettingEngine(store);
const sharingManager = new SharingManager(store);

const server = createMcpServer({
  store,
  recallEngine,
  forgettingEngine,
  sharingManager,
});

const transport = new StdioServerTransport();

async function main() {
  await server.connect(transport);
  // Server runs until stdin closes
}

main().catch((err) => {
  console.error("Engram MCP server error:", err);
  process.exit(1);
});
