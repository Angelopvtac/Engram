import type { MemoryStore } from "../store/index.js";
import type {
  Memory,
  RecallResult,
  RecallFilters,
  Episode,
  SemanticFact,
  WorkingEntry,
} from "../types.js";

/** Scored memory for ranking */
interface ScoredMemory {
  memory: Memory;
  score: number;
  tokenEstimate: number;
}

/**
 * RecallEngine — retrieves relevant memories from all tiers based on a
 * natural language query. Ranks by recency, relevance, confidence, and
 * frequency. Respects configurable budget constraints.
 */
export class RecallEngine {
  /** Exponential decay half-life in milliseconds (default: 7 days) */
  private recencyHalfLife: number;

  constructor(
    private store: MemoryStore,
    opts?: { recencyHalfLifeMs?: number }
  ) {
    this.recencyHalfLife = opts?.recencyHalfLifeMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * Recall memories relevant to a query, ranked and budget-constrained.
   * @param query Natural language query
   * @param filters Optional recall filters
   */
  recall(query: string, filters: RecallFilters = {}): RecallResult {
    const candidates: ScoredMemory[] = [];
    const tiers = filters.tiers ?? ["working", "episodic", "semantic"];
    const keywords = this.extractKeywords(query);

    if (tiers.includes("working") && filters.agentId) {
      const entries = this.store.working.list(filters.agentId);
      for (const entry of entries) {
        const relevance = this.keywordScore(
          `${entry.key} ${entry.value}`,
          keywords
        );
        if (relevance > 0 || !query) {
          candidates.push({
            memory: { tier: "working", data: entry },
            score: this.scoreWorking(entry, relevance),
            tokenEstimate: this.estimateTokens(entry.value),
          });
        }
      }
    }

    if (tiers.includes("episodic")) {
      const episodes = this.store.episodic.search(query, {
        agentId: filters.agentId,
        timeRange: filters.timeRange,
        limit: 200,
      });
      for (const ep of episodes) {
        const relevance = this.keywordScore(
          `${ep.who} ${ep.what} ${ep.context} ${ep.outcome}`,
          keywords
        );
        candidates.push({
          memory: { tier: "episodic", data: ep },
          score: this.scoreEpisodic(ep, relevance),
          tokenEstimate: this.estimateTokens(
            `${ep.who} ${ep.what} ${ep.context} ${ep.outcome}`
          ),
        });
      }
    }

    if (tiers.includes("semantic")) {
      const facts = this.store.semantic.query(query, {
        agentId: filters.agentId,
        minConfidence: filters.minConfidence,
        limit: 200,
      });
      for (const fact of facts) {
        const relevance = this.keywordScore(
          `${fact.topic} ${fact.fact}`,
          keywords
        );
        candidates.push({
          memory: { tier: "semantic", data: fact },
          score: this.scoreSemantic(fact, relevance),
          tokenEstimate: this.estimateTokens(fact.fact),
        });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Apply budget constraints
    const maxResults = filters.maxResults ?? 20;
    const maxTokens = filters.maxTokens ?? Infinity;
    const selected: Memory[] = [];
    let totalTokens = 0;

    for (const c of candidates) {
      if (selected.length >= maxResults) break;
      if (totalTokens + c.tokenEstimate > maxTokens) continue;
      selected.push(c.memory);
      totalTokens += c.tokenEstimate;
    }

    return {
      memories: selected,
      totalTokens,
      query,
      filters,
    };
  }

  /** Score a working memory entry */
  private scoreWorking(entry: WorkingEntry, relevance: number): number {
    const recency = this.recencyScore(entry.lastAccessedAt);
    const frequency = Math.log2(1 + entry.accessCount) / 10;
    return relevance * 0.5 + recency * 0.3 + frequency * 0.2;
  }

  /** Score an episodic memory */
  private scoreEpisodic(episode: Episode, relevance: number): number {
    const recency = this.recencyScore(episode.timestamp);
    const frequency = Math.log2(1 + episode.accessCount) / 10;
    return relevance * 0.4 + recency * 0.35 + frequency * 0.25;
  }

  /** Score a semantic memory */
  private scoreSemantic(fact: SemanticFact, relevance: number): number {
    const recency = this.recencyScore(fact.lastVerifiedAt);
    const confidence = fact.confidence;
    const frequency = Math.log2(1 + fact.accessCount) / 10;
    return relevance * 0.3 + confidence * 0.3 + recency * 0.2 + frequency * 0.2;
  }

  /** Exponential decay recency score (0..1) */
  private recencyScore(timestamp: number): number {
    const age = Date.now() - timestamp;
    return Math.pow(2, -age / this.recencyHalfLife);
  }

  /** Simple keyword relevance score (0..1) */
  private keywordScore(text: string, keywords: string[]): number {
    if (keywords.length === 0) return 0.5;
    const lower = text.toLowerCase();
    let matches = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) matches++;
    }
    return matches / keywords.length;
  }

  /** Extract lowercase keywords from a query string */
  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      "a", "an", "the", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will",
      "would", "could", "should", "may", "might", "can", "shall",
      "to", "of", "in", "for", "on", "with", "at", "by", "from",
      "as", "into", "about", "between", "through", "during", "before",
      "after", "above", "below", "and", "but", "or", "not", "no",
      "if", "then", "else", "when", "up", "out", "so", "than",
      "too", "very", "just", "that", "this", "it", "i", "me", "my",
      "we", "our", "you", "your", "he", "she", "they", "them",
      "what", "which", "who", "whom", "how", "where", "why",
    ]);
    return query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));
  }

  /** Rough token estimate (~4 chars per token) */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
