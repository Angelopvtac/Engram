export { MemoryStore } from "./store/index.js";
export { RecallEngine } from "./recall/index.js";
export { ForgettingEngine } from "./forgetting/index.js";
export { IntegrityGuard } from "./integrity/index.js";
export { SharingManager } from "./sharing/index.js";

// Embeddings
export {
  createEmbeddingProvider,
  OpenAIEmbeddingProvider,
  LocalEmbeddingProvider,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
} from "./embeddings/index.js";
export type {
  EmbeddingProvider,
  EmbeddingConfig,
} from "./embeddings/index.js";

// MCP
export { createMcpServer } from "./mcp/index.js";
export type { McpServerOptions } from "./mcp/index.js";

// API
export { createApiServer } from "./api/index.js";
export type { ApiServerOptions } from "./api/index.js";

export type {
  MemoryTier,
  SharingVisibility,
  WorkingEntry,
  Episode,
  SemanticFact,
  Memory,
  EpisodicSearchOptions,
  SemanticQueryOptions,
  RecallResult,
  RecallFilters,
  ForgettingPolicy,
  ForgettingReport,
  ForgettingReason,
  IntegrityResult,
  SharingConfig,
  AuditEntry,
  MemoryStats,
} from "./types.js";
