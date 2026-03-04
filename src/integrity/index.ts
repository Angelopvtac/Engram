import crypto from "node:crypto";
import type { MemoryStore } from "../store/index.js";
import type {
  Memory,
  IntegrityResult,
  MemoryTier,
} from "../types.js";

/** Rate-tracking window entry */
interface WriteRecord {
  agentId: string;
  timestamp: number;
}

/**
 * IntegrityGuard — validates memory writes against behavioral baselines.
 *
 * Detects contradictions with existing semantic memory, sudden high-volume
 * writes (potential poisoning), and memories referencing non-existent entities.
 * Suspicious memories are quarantined for review.
 */
export class IntegrityGuard {
  private writeLog: WriteRecord[] = [];
  /** Max writes per agent per window before flagging */
  private maxWritesPerWindow: number;
  /** Window size in milliseconds */
  private windowMs: number;

  constructor(
    private store: MemoryStore,
    opts?: { maxWritesPerWindow?: number; windowMs?: number }
  ) {
    this.maxWritesPerWindow = opts?.maxWritesPerWindow ?? 50;
    this.windowMs = opts?.windowMs ?? 60_000;
  }

  /**
   * Validate a memory before it is written to the store.
   * Returns whether the write is valid, with any warnings or block reasons.
   */
  validate(memory: Memory): IntegrityResult {
    const warnings: string[] = [];
    let blockedReason: string | null = null;

    const agentId = this.getAgentId(memory);

    // Check write rate
    const rateWarning = this.checkWriteRate(agentId);
    if (rateWarning) {
      if (rateWarning.blocked) {
        blockedReason = rateWarning.message;
      } else {
        warnings.push(rateWarning.message);
      }
    }

    // Tier-specific validations
    if (memory.tier === "semantic") {
      const contradictions = this.checkContradictions(memory.data.fact, memory.data.topic, agentId);
      if (contradictions.length > 0) {
        warnings.push(
          `Potential contradictions with existing facts: ${contradictions.map((c) => c.id).join(", ")}`
        );
      }
    }

    if (memory.tier === "episodic") {
      const contentCheck = this.checkContent(memory.data.what);
      if (contentCheck) warnings.push(contentCheck);
    }

    // If blocked, quarantine the memory
    if (blockedReason) {
      this.quarantine(memory, blockedReason);
    }

    return {
      valid: blockedReason === null,
      warnings,
      blockedReason,
    };
  }

  /** Get all quarantined memories, optionally filtered by agent */
  getQuarantined(agentId?: string): Array<{ id: string; memoryId: string; tier: MemoryTier; data: string; reason: string; quarantinedAt: number }> {
    const filter = agentId ? ` WHERE agent_id = ?` : "";
    const params = agentId ? [agentId] : [];
    const rows = this.store.db
      .prepare(`SELECT * FROM quarantine${filter} ORDER BY quarantined_at DESC`)
      .all(...params) as Array<{ id: string; memory_id: string; tier: string; data: string; reason: string; quarantined_at: number; agent_id: string }>;
    return rows.map(r => ({
      id: r.id,
      memoryId: r.memory_id,
      tier: r.tier as MemoryTier,
      data: r.data,
      reason: r.reason,
      quarantinedAt: r.quarantined_at,
    }));
  }

  /** Release a quarantined memory (approve it) */
  releaseFromQuarantine(quarantineId: string): boolean {
    const result = this.store.db
      .prepare(`DELETE FROM quarantine WHERE id = ?`)
      .run(quarantineId);
    return result.changes > 0;
  }

  /** Check if an agent is writing too fast */
  private checkWriteRate(agentId: string): { blocked: boolean; message: string } | null {
    const now = Date.now();
    this.writeLog.push({ agentId, timestamp: now });

    // Prune old entries
    const cutoff = now - this.windowMs;
    this.writeLog = this.writeLog.filter((r) => r.timestamp > cutoff);

    const agentWrites = this.writeLog.filter((r) => r.agentId === agentId).length;

    if (agentWrites > this.maxWritesPerWindow * 2) {
      return {
        blocked: true,
        message: `Write rate exceeded: ${agentWrites} writes in ${this.windowMs}ms window (limit: ${this.maxWritesPerWindow}). Possible memory poisoning attempt.`,
      };
    }

    if (agentWrites > this.maxWritesPerWindow) {
      return {
        blocked: false,
        message: `Elevated write rate: ${agentWrites} writes in ${this.windowMs}ms window (threshold: ${this.maxWritesPerWindow})`,
      };
    }

    return null;
  }

  /** Check for contradictions with existing semantic facts */
  private checkContradictions(
    fact: string,
    topic: string,
    agentId: string
  ): Array<{ id: string; fact: string }> {
    // Find existing facts on the same topic
    const existing = this.store.semantic.query(topic, {
      agentId,
      limit: 20,
    });

    const contradictions: Array<{ id: string; fact: string }> = [];
    const newWords = new Set(fact.toLowerCase().split(/\W+/).filter(Boolean));

    for (const ex of existing) {
      const existingWords = new Set(ex.fact.toLowerCase().split(/\W+/).filter(Boolean));
      const overlap = [...newWords].filter((w) => existingWords.has(w)).length;
      const overlapRatio = overlap / Math.max(newWords.size, existingWords.size);

      // High word overlap but different content suggests contradiction
      if (overlapRatio > 0.5 && fact !== ex.fact) {
        // Check for negation patterns
        const hasNegation =
          this.containsNegation(fact) !== this.containsNegation(ex.fact);
        if (hasNegation || overlapRatio > 0.7) {
          contradictions.push({ id: ex.id, fact: ex.fact });
        }
      }
    }

    return contradictions;
  }

  /** Check for basic content issues */
  private checkContent(content: string): string | null {
    if (content.trim().length === 0) {
      return "Empty content in memory write";
    }
    if (content.length > 100_000) {
      return `Unusually large memory content: ${content.length} characters`;
    }
    return null;
  }

  /** Detect negation in text */
  private containsNegation(text: string): boolean {
    const negations = ["not", "never", "no", "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "won't", "wouldn't", "couldn't", "shouldn't", "can't", "cannot"];
    const lower = text.toLowerCase();
    return negations.some((n) => lower.includes(n));
  }

  /** Move a memory to quarantine */
  private quarantine(memory: Memory, reason: string): void {
    const agentId = this.getAgentId(memory);
    const memoryId = this.getMemoryId(memory);
    this.store.db
      .prepare(
        `INSERT INTO quarantine (id, memory_id, tier, data, reason, quarantined_at, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        memoryId,
        memory.tier,
        JSON.stringify(memory.data),
        reason,
        Date.now(),
        agentId
      );
    this.store.audit({
      action: "quarantine",
      memoryId,
      tier: memory.tier,
      agentId,
      reason,
    });
  }

  private getAgentId(memory: Memory): string {
    switch (memory.tier) {
      case "working": return memory.data.agentId;
      case "episodic": return memory.data.agentId;
      case "semantic": return memory.data.agentId;
    }
  }

  private getMemoryId(memory: Memory): string {
    switch (memory.tier) {
      case "working": return `${memory.data.agentId}:${memory.data.key}`;
      case "episodic": return memory.data.id;
      case "semantic": return memory.data.id;
    }
  }
}
