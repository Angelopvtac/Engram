import crypto from "node:crypto";
import type { MemoryStore } from "../store/index.js";
import type {
  ForgettingPolicy,
  ForgettingReport,
  ForgettingReason,
  MemoryTier,
  SharingVisibility,
} from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ForgettingEngine — policy-driven memory expiration.
 *
 * Supports time-based, confidence-based, access-based, explicit, and GDPR forgetting.
 * Can be run on a schedule or on-demand.
 */
export class ForgettingEngine {
  constructor(private store: MemoryStore) {}

  /**
   * Execute a forgetting policy against the memory store.
   * Returns a report of what was deleted, demoted, or retained.
   */
  execute(policy: ForgettingPolicy, agentId?: string): ForgettingReport {
    switch (policy.type) {
      case "time_based":
        return this.executeTimeBased(policy, agentId);
      case "confidence_based":
        return this.executeConfidenceBased(policy, agentId);
      case "access_based":
        return this.executeAccessBased(policy, agentId);
      case "explicit":
        return this.executeExplicit(policy, agentId);
      case "gdpr":
        return this.executeGdpr(policy, agentId);
      default:
        return this.emptyReport(policy.name);
    }
  }

  /**
   * Run multiple policies in sequence.
   */
  executeAll(policies: ForgettingPolicy[], agentId?: string): ForgettingReport[] {
    return policies.map((p) => this.execute(p, agentId));
  }

  /** Time-based: delete memories older than their tier's TTL */
  private executeTimeBased(policy: ForgettingPolicy, agentId?: string): ForgettingReport {
    const reasons: ForgettingReason[] = [];
    let deleted = 0;
    const ts = Date.now();

    // Working memory — delete expired entries
    if (policy.ttl?.working) {
      const cutoff = ts - policy.ttl.working;
      const agentFilter = agentId ? ` AND agent_id = ?` : "";
      const params: unknown[] = [cutoff];
      if (agentId) params.push(agentId);

      const rows = this.store.db
        .prepare(`SELECT key, agent_id FROM working_memory WHERE created_at < ?${agentFilter}`)
        .all(...params) as { key: string; agent_id: string }[];

      for (const row of rows) {
        this.store.working.delete(row.agent_id, row.key);
        this.store.audit({
          action: "delete",
          memoryId: `${row.agent_id}:${row.key}`,
          tier: "working",
          agentId: row.agent_id,
          reason: `Exceeded TTL of ${policy.ttl.working}ms`,
        });
        reasons.push({
          memoryId: `${row.agent_id}:${row.key}`,
          tier: "working",
          action: "deleted",
          reason: `Exceeded TTL of ${policy.ttl.working}ms`,
        });
        deleted++;
      }
    }

    // Episodic memory
    if (policy.ttl?.episodic) {
      const cutoff = ts - policy.ttl.episodic;
      const agentFilter = agentId ? ` AND agent_id = ?` : "";
      const params: unknown[] = [cutoff];
      if (agentId) params.push(agentId);

      const rows = this.store.db
        .prepare(`SELECT id, agent_id FROM episodic_memory WHERE timestamp < ?${agentFilter}`)
        .all(...params) as { id: string; agent_id: string }[];

      for (const row of rows) {
        this.store.episodic.delete(row.id);
        this.store.audit({
          action: "delete",
          memoryId: row.id,
          tier: "episodic",
          agentId: row.agent_id,
          reason: `Exceeded TTL of ${policy.ttl.episodic}ms`,
        });
        reasons.push({
          memoryId: row.id,
          tier: "episodic",
          action: "deleted",
          reason: `Exceeded TTL of ${policy.ttl.episodic}ms`,
        });
        deleted++;
      }
    }

    // Semantic memory
    if (policy.ttl?.semantic) {
      const cutoff = ts - policy.ttl.semantic;
      const agentFilter = agentId ? ` AND agent_id = ?` : "";
      const params: unknown[] = [cutoff];
      if (agentId) params.push(agentId);

      const rows = this.store.db
        .prepare(`SELECT id, agent_id FROM semantic_memory WHERE created_at < ?${agentFilter}`)
        .all(...params) as { id: string; agent_id: string }[];

      for (const row of rows) {
        this.store.semantic.delete(row.id);
        this.store.audit({
          action: "delete",
          memoryId: row.id,
          tier: "semantic",
          agentId: row.agent_id,
          reason: `Exceeded TTL of ${policy.ttl.semantic}ms`,
        });
        reasons.push({
          memoryId: row.id,
          tier: "semantic",
          action: "deleted",
          reason: `Exceeded TTL of ${policy.ttl.semantic}ms`,
        });
        deleted++;
      }
    }

    return this.buildReport(policy.name, deleted, 0, reasons);
  }

  /** Confidence-based: demote or delete low-confidence semantic memories */
  private executeConfidenceBased(policy: ForgettingPolicy, agentId?: string): ForgettingReport {
    const threshold = policy.confidenceThreshold ?? 0.3;
    const reasons: ForgettingReason[] = [];
    let deleted = 0;
    let demoted = 0;

    const agentFilter = agentId ? ` AND agent_id = ?` : "";
    const params: unknown[] = [threshold];
    if (agentId) params.push(agentId);

    const rows = this.store.db
      .prepare(
        `SELECT id, agent_id, fact, confidence, topic FROM semantic_memory WHERE confidence < ?${agentFilter}`
      )
      .all(...params) as { id: string; agent_id: string; fact: string; confidence: number; topic: string }[];

    for (const row of rows) {
      if (row.confidence < threshold / 2) {
        // Very low confidence — delete
        this.store.semantic.delete(row.id);
        this.store.audit({
          action: "delete",
          memoryId: row.id,
          tier: "semantic",
          agentId: row.agent_id,
          reason: `Confidence ${row.confidence} below deletion threshold ${threshold / 2}`,
        });
        reasons.push({
          memoryId: row.id,
          tier: "semantic",
          action: "deleted",
          reason: `Confidence ${row.confidence.toFixed(2)} below ${(threshold / 2).toFixed(2)}`,
        });
        deleted++;
      } else {
        // Low confidence — demote to episodic
        this.store.episodic.store(row.agent_id, {
          who: "system",
          what: `Demoted semantic fact: ${row.fact}`,
          context: `topic=${row.topic}, confidence=${row.confidence}`,
          outcome: "demoted from semantic tier",
          timestamp: Date.now(),
          visibility: "private" as SharingVisibility,
          expiresAt: null,
          metadata: { demotedFrom: "semantic", originalId: row.id },
        });
        this.store.semantic.delete(row.id);
        this.store.audit({
          action: "demote",
          memoryId: row.id,
          tier: "semantic",
          agentId: row.agent_id,
          reason: `Confidence ${row.confidence} below threshold ${threshold}`,
        });
        reasons.push({
          memoryId: row.id,
          tier: "semantic",
          action: "demoted",
          reason: `Confidence ${row.confidence.toFixed(2)} below ${threshold.toFixed(2)}, demoted to episodic`,
        });
        demoted++;
      }
    }

    return this.buildReport(policy.name, deleted, demoted, reasons);
  }

  /** Access-based: delete/demote memories not accessed in N days */
  private executeAccessBased(policy: ForgettingPolicy, agentId?: string): ForgettingReport {
    const inactiveDays = policy.inactiveDays ?? 30;
    const cutoff = Date.now() - inactiveDays * DAY_MS;
    const reasons: ForgettingReason[] = [];
    let deleted = 0;
    let demoted = 0;

    const agentFilter = agentId ? ` AND agent_id = ?` : "";

    // Episodic — delete inactive episodes
    const epParams: unknown[] = [cutoff];
    if (agentId) epParams.push(agentId);

    const episodes = this.store.db
      .prepare(
        `SELECT id, agent_id FROM episodic_memory WHERE last_accessed_at < ?${agentFilter}`
      )
      .all(...epParams) as { id: string; agent_id: string }[];

    for (const row of episodes) {
      this.store.episodic.delete(row.id);
      this.store.audit({
        action: "delete",
        memoryId: row.id,
        tier: "episodic",
        agentId: row.agent_id,
        reason: `Not accessed in ${inactiveDays} days`,
      });
      reasons.push({
        memoryId: row.id,
        tier: "episodic",
        action: "deleted",
        reason: `Not accessed in ${inactiveDays} days`,
      });
      deleted++;
    }

    // Semantic — demote to episodic if inactive
    const semParams: unknown[] = [cutoff];
    if (agentId) semParams.push(agentId);

    const facts = this.store.db
      .prepare(
        `SELECT id, agent_id, fact, topic, confidence FROM semantic_memory WHERE last_accessed_at < ?${agentFilter}`
      )
      .all(...semParams) as { id: string; agent_id: string; fact: string; topic: string; confidence: number }[];

    for (const row of facts) {
      this.store.episodic.store(row.agent_id, {
        who: "system",
        what: `Demoted inactive fact: ${row.fact}`,
        context: `topic=${row.topic}, confidence=${row.confidence}`,
        outcome: "demoted due to inactivity",
        timestamp: Date.now(),
        visibility: "private" as SharingVisibility,
        expiresAt: null,
        metadata: { demotedFrom: "semantic", originalId: row.id },
      });
      this.store.semantic.delete(row.id);
      this.store.audit({
        action: "demote",
        memoryId: row.id,
        tier: "semantic",
        agentId: row.agent_id,
        reason: `Not accessed in ${inactiveDays} days`,
      });
      reasons.push({
        memoryId: row.id,
        tier: "semantic",
        action: "demoted",
        reason: `Not accessed in ${inactiveDays} days, demoted to episodic`,
      });
      demoted++;
    }

    return this.buildReport(policy.name, deleted, demoted, reasons);
  }

  /** Explicit: admin/user triggered deletion of a specific entity or topic */
  private executeExplicit(policy: ForgettingPolicy, agentId?: string): ForgettingReport {
    const target = policy.target;
    if (!target) return this.emptyReport(policy.name);

    const reasons: ForgettingReason[] = [];
    let deleted = 0;
    const pattern = `%${this.escapeLike(target)}%`;

    const agentFilter = agentId ? ` AND agent_id = ?` : "";

    // Episodic
    const epParams: unknown[] = [pattern, pattern, pattern, pattern];
    if (agentId) epParams.push(agentId);
    const episodes = this.store.db
      .prepare(
        `SELECT id, agent_id FROM episodic_memory WHERE (who LIKE ? ESCAPE '\\' OR what LIKE ? ESCAPE '\\' OR context LIKE ? ESCAPE '\\' OR outcome LIKE ? ESCAPE '\\')${agentFilter}`
      )
      .all(...epParams) as { id: string; agent_id: string }[];

    for (const row of episodes) {
      this.store.episodic.delete(row.id);
      this.store.audit({
        action: "delete",
        memoryId: row.id,
        tier: "episodic",
        agentId: row.agent_id,
        reason: `Explicit deletion targeting "${target}"`,
      });
      reasons.push({
        memoryId: row.id,
        tier: "episodic",
        action: "deleted",
        reason: `Matches explicit target "${target}"`,
      });
      deleted++;
    }

    // Semantic
    const semParams: unknown[] = [pattern, pattern];
    if (agentId) semParams.push(agentId);
    const facts = this.store.db
      .prepare(
        `SELECT id, agent_id FROM semantic_memory WHERE (fact LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\')${agentFilter}`
      )
      .all(...semParams) as { id: string; agent_id: string }[];

    for (const row of facts) {
      this.store.semantic.delete(row.id);
      this.store.audit({
        action: "delete",
        memoryId: row.id,
        tier: "semantic",
        agentId: row.agent_id,
        reason: `Explicit deletion targeting "${target}"`,
      });
      reasons.push({
        memoryId: row.id,
        tier: "semantic",
        action: "deleted",
        reason: `Matches explicit target "${target}"`,
      });
      deleted++;
    }

    return this.buildReport(policy.name, deleted, 0, reasons);
  }

  /** GDPR right-to-erasure: delete all memories related to an entity */
  private executeGdpr(policy: ForgettingPolicy, agentId?: string): ForgettingReport {
    // GDPR is the same as explicit but also purges working memory and audit log
    const report = this.executeExplicit(policy, agentId);
    const target = policy.target;
    if (!target) return report;

    const pattern = `%${this.escapeLike(target)}%`;

    // Also purge working memory
    const agentFilter = agentId ? ` AND agent_id = ?` : "";
    const wkParams: unknown[] = [pattern, pattern];
    if (agentId) wkParams.push(agentId);

    const workingRows = this.store.db
      .prepare(
        `SELECT key, agent_id FROM working_memory WHERE (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\')${agentFilter}`
      )
      .all(...wkParams) as { key: string; agent_id: string }[];

    for (const row of workingRows) {
      this.store.working.delete(row.agent_id, row.key);
      report.deleted++;
      report.reasons.push({
        memoryId: `${row.agent_id}:${row.key}`,
        tier: "working",
        action: "deleted",
        reason: `GDPR erasure for "${target}"`,
      });
    }

    // Purge quarantine entries matching target
    this.store.db
      .prepare(`DELETE FROM quarantine WHERE data LIKE ? ESCAPE '\\'`)
      .run(pattern);

    // Purge audit log entries that reference the target (PII)
    this.store.db
      .prepare(`DELETE FROM audit_log WHERE reason LIKE ? ESCAPE '\\'`)
      .run(pattern);

    // Anonymized completion audit entry (no PII)
    const hash = crypto.createHash("sha256").update(target).digest("hex").slice(0, 8);
    this.store.audit({
      action: "delete",
      memoryId: `gdpr:${hash}`,
      tier: "working",
      agentId: agentId || "system",
      reason: "GDPR right-to-erasure completed",
    });

    return report;
  }

  /** Escape LIKE wildcards in user-supplied strings */
  private escapeLike(s: string): string {
    return s.replace(/[%_\\]/g, "\\$&");
  }

  private buildReport(
    policyName: string,
    deleted: number,
    demoted: number,
    reasons: ForgettingReason[]
  ): ForgettingReport {
    const retained = reasons.filter((r) => r.action === "retained").length;
    return {
      policy: policyName,
      deleted,
      demoted,
      retained,
      reasons,
      executedAt: Date.now(),
    };
  }

  private emptyReport(policyName: string): ForgettingReport {
    return {
      policy: policyName,
      deleted: 0,
      demoted: 0,
      retained: 0,
      reasons: [],
      executedAt: Date.now(),
    };
  }
}
