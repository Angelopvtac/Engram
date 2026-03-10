#!/usr/bin/env node
/**
 * Engram REST API server entry point.
 *
 * Usage:
 *   engram-api [--port <port>] [--db <path>]
 *
 * Environment:
 *   PORT — HTTP port (default: 3847)
 *   ENGRAM_DB_PATH — SQLite database path (default: ./engram.db)
 */

import { MemoryStore } from "../store/index.js";
import { RecallEngine } from "../recall/index.js";
import { ForgettingEngine } from "../forgetting/index.js";
import { SharingManager } from "../sharing/index.js";
import { createApiServer } from "./index.js";

const args = process.argv.slice(2);

function getArg(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const port = parseInt(getArg("--port", process.env.PORT ?? "3847"), 10);
const dbPath = getArg("--db", process.env.ENGRAM_DB_PATH ?? "./engram.db");

const store = new MemoryStore(dbPath);
const recallEngine = new RecallEngine(store);
const forgettingEngine = new ForgettingEngine(store);
const sharingManager = new SharingManager(store);

const host = getArg("--host", process.env.ENGRAM_HOST ?? "127.0.0.1");

async function main() {
  const app = await createApiServer({
    store,
    recallEngine,
    forgettingEngine,
    sharingManager,
    port,
    host,
  });

  await app.listen({ port, host });
  console.log(`Engram API server listening on http://${host}:${port}`);
  console.log(`Swagger docs at http://${host}:${port}/docs`);
}

// Graceful shutdown
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down...`);
    store.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Engram API server error:", err);
  store.close();
  process.exit(1);
});
