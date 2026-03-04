export { MemoryStore } from "./store/index.js";
export { RecallEngine } from "./recall/index.js";
export { ForgettingEngine } from "./forgetting/index.js";
export { IntegrityGuard } from "./integrity/index.js";
export { SharingManager } from "./sharing/index.js";

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
