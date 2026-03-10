/**
 * Engram REST API server built with Fastify.
 * Exposes all memory operations over HTTP with OpenAPI docs.
 */

import Fastify, { type FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { MemoryStore } from "../store/index.js";
import { RecallEngine } from "../recall/index.js";
import { ForgettingEngine } from "../forgetting/index.js";
import { SharingManager } from "../sharing/index.js";
import { registerRoutes } from "./routes.js";

export interface ApiServerOptions {
  store: MemoryStore;
  recallEngine?: RecallEngine;
  forgettingEngine?: ForgettingEngine;
  sharingManager?: SharingManager;
  port?: number;
  host?: string;
  /** API key for authentication. If set, all requests must include Authorization: Bearer <key>. */
  apiKey?: string;
}

export async function createApiServer(opts: ApiServerOptions): Promise<FastifyInstance> {
  const { store } = opts;
  const recall = opts.recallEngine ?? new RecallEngine(store);
  const forgetting = opts.forgettingEngine ?? new ForgettingEngine(store);
  const sharing = opts.sharingManager ?? new SharingManager(store);

  const app = Fastify({ logger: true });

  // API key authentication
  const apiKey = opts.apiKey ?? process.env.ENGRAM_API_KEY;
  if (apiKey) {
    app.addHook("onRequest", async (request, reply) => {
      // Skip auth for health check and docs
      if (request.url === "/api/v1/health" || request.url.startsWith("/docs")) return;
      const auth = request.headers.authorization;
      if (!auth || auth !== `Bearer ${apiKey}`) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    });
  }

  // Swagger docs
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Engram Memory API",
        description: "REST API for Engram 3-tier cognitive memory system",
        version: "0.1.0",
      },
      tags: [
        { name: "memory", description: "Core memory operations" },
        { name: "working", description: "Working memory operations" },
        { name: "sharing", description: "Memory sharing operations" },
        { name: "health", description: "Health check" },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  // Decorate with dependencies
  app.decorate("store", store);
  app.decorate("recall", recall);
  app.decorate("forgetting", forgetting);
  app.decorate("sharing", sharing);

  // Register routes
  registerRoutes(app, { store, recall, forgetting, sharing });

  return app;
}
