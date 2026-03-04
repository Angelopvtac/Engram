/** Memory tier classification */
export type MemoryTier = "working" | "episodic" | "semantic";

/** Visibility for cross-agent sharing */
export type SharingVisibility = "private" | "team" | "public";

/** A working memory entry — ephemeral key-value with TTL */
export interface WorkingEntry {
  key: string;
  value: string;
  agentId: string;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

/** An episodic memory — a record of a past interaction or event */
export interface Episode {
  id: string;
  agentId: string;
  who: string;
  what: string;
  context: string;
  outcome: string;
  timestamp: number;
  visibility: SharingVisibility;
  accessCount: number;
  lastAccessedAt: number;
  expiresAt: number | null;
  metadata: Record<string, unknown>;
}

/** A semantic memory — a learned fact, pattern, or preference */
export interface SemanticFact {
  id: string;
  agentId: string;
  fact: string;
  topic: string;
  confidence: number;
  sourceEpisodeIds: string[];
  visibility: SharingVisibility;
  accessCount: number;
  lastAccessedAt: number;
  lastVerifiedAt: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}

/** Union type for any memory */
export type Memory =
  | { tier: "working"; data: WorkingEntry }
  | { tier: "episodic"; data: Episode }
  | { tier: "semantic"; data: SemanticFact };

/** Options for episodic search */
export interface EpisodicSearchOptions {
  agentId?: string;
  timeRange?: { start: number; end: number };
  limit?: number;
  visibility?: SharingVisibility;
}

/** Options for semantic queries */
export interface SemanticQueryOptions {
  agentId?: string;
  minConfidence?: number;
  limit?: number;
  visibility?: SharingVisibility;
}

/** Result of a recall operation */
export interface RecallResult {
  memories: Memory[];
  totalTokens: number;
  query: string;
  filters: RecallFilters;
}

/** Filters for recall queries */
export interface RecallFilters {
  tiers?: MemoryTier[];
  timeRange?: { start: number; end: number };
  agentId?: string;
  minConfidence?: number;
  maxResults?: number;
  maxTokens?: number;
}

/** A forgetting policy definition */
export interface ForgettingPolicy {
  name: string;
  type: "time_based" | "confidence_based" | "access_based" | "explicit" | "gdpr";
  /** For time_based: TTL in ms per tier */
  ttl?: Partial<Record<MemoryTier, number>>;
  /** For confidence_based: threshold below which memories decay faster */
  confidenceThreshold?: number;
  /** For access_based: days since last access before demotion/deletion */
  inactiveDays?: number;
  /** For gdpr/explicit: entity or topic to purge */
  target?: string;
}

/** Report returned after a forgetting pass */
export interface ForgettingReport {
  policy: string;
  deleted: number;
  demoted: number;
  retained: number;
  reasons: ForgettingReason[];
  executedAt: number;
}

/** Individual reason entry in a forgetting report */
export interface ForgettingReason {
  memoryId: string;
  tier: MemoryTier;
  action: "deleted" | "demoted" | "retained";
  reason: string;
}

/** Result of an integrity validation */
export interface IntegrityResult {
  valid: boolean;
  warnings: string[];
  blockedReason: string | null;
}

/** Configuration for cross-agent sharing */
export interface SharingConfig {
  agentId: string;
  teamId: string | null;
  defaultVisibility: Partial<Record<MemoryTier, SharingVisibility>>;
}

/** Audit log entry for memory operations */
export interface AuditEntry {
  id: string;
  action: "store" | "delete" | "demote" | "share" | "revoke" | "quarantine";
  memoryId: string;
  tier: MemoryTier;
  agentId: string;
  reason: string;
  timestamp: number;
}

/** Memory store statistics */
export interface MemoryStats {
  working: { count: number; totalSize: number };
  episodic: { count: number; totalSize: number; avgAge: number };
  semantic: { count: number; totalSize: number; avgConfidence: number };
  quarantined: number;
  auditEntries: number;
}
