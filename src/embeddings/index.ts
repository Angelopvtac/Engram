/**
 * Embedding providers for vector-based semantic search.
 *
 * Pluggable architecture: use OpenAI for production quality,
 * or the local TF-IDF fallback for zero-dependency operation.
 */

/** Interface for embedding providers */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

/** Configuration for creating an embedding provider */
export interface EmbeddingConfig {
  provider: "openai" | "local";
  /** OpenAI API key (required for openai provider) */
  apiKey?: string;
  /** OpenAI model (default: text-embedding-3-small) */
  model?: string;
  /** Dimensions for local provider (default: 128) */
  localDimensions?: number;
}

/**
 * Factory function to create an embedding provider.
 * Returns null if configuration is insufficient.
 */
export function createEmbeddingProvider(config?: EmbeddingConfig): EmbeddingProvider | null {
  if (!config) return null;

  if (config.provider === "openai") {
    if (!config.apiKey && !process.env.OPENAI_API_KEY) return null;
    return new OpenAIEmbeddingProvider(
      config.apiKey || process.env.OPENAI_API_KEY!,
      config.model
    );
  }

  if (config.provider === "local") {
    return new LocalEmbeddingProvider(config.localDimensions);
  }

  return null;
}

/**
 * OpenAI embedding provider using text-embedding-3-small.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? "text-embedding-3-small";
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embedding API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to preserve input order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

/**
 * Local embedding provider using a simple TF-IDF-like bag-of-words approach.
 * No external dependencies required. Useful for testing and offline operation.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;

  constructor(dimensions?: number) {
    this.dimensions = dimensions ?? 128;
  }

  async embed(text: string): Promise<number[]> {
    return this.computeEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.computeEmbedding(t));
  }

  /**
   * Compute a deterministic embedding using character n-gram hashing.
   * This gives reasonable similarity for lexically similar texts.
   */
  private computeEmbedding(text: string): number[] {
    const vec = new Float64Array(this.dimensions);
    const normalized = text.toLowerCase().trim();

    if (normalized.length === 0) return Array.from(vec);

    // Extract words and character trigrams
    const words = normalized.split(/\W+/).filter((w) => w.length > 0);

    // Word-level hashing
    for (const word of words) {
      const hash = this.simpleHash(word);
      const idx = Math.abs(hash) % this.dimensions;
      vec[idx] += hash > 0 ? 1 : -1;

      // Character trigrams for sub-word similarity
      for (let i = 0; i <= word.length - 3; i++) {
        const trigram = word.substring(i, i + 3);
        const tHash = this.simpleHash(trigram);
        const tIdx = Math.abs(tHash) % this.dimensions;
        vec[tIdx] += tHash > 0 ? 0.5 : -0.5;
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vec[i] /= norm;
      }
    }

    return Array.from(vec);
  }

  /** Simple deterministic hash function */
  private simpleHash(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash;
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical, 0 = orthogonal).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}

/**
 * Serialize an embedding vector to a Buffer for SQLite BLOB storage.
 */
export function serializeEmbedding(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 8);
  for (let i = 0; i < vec.length; i++) {
    buf.writeDoubleBE(vec[i], i * 8);
  }
  return buf;
}

/**
 * Deserialize a Buffer from SQLite back to a number array.
 */
export function deserializeEmbedding(buf: Buffer): number[] {
  if (buf.length % 8 !== 0) {
    throw new Error(`Invalid embedding buffer: length ${buf.length} is not a multiple of 8`);
  }
  const vec: number[] = [];
  for (let i = 0; i < buf.length; i += 8) {
    vec.push(buf.readDoubleBE(i));
  }
  return vec;
}
