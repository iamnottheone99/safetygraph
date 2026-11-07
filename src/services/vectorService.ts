import { Pool } from 'pg';
import pino from 'pino';
import OpenAI from 'openai';
import { circuitManager } from '../utils/circuitBreaker';
import { env } from '../config/env';

const logger = pino();

export interface VectorDocument {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  similarity?: number;
  embedding?: number[];
}

export class VectorService {
  private pool: Pool | null = null;
  private dbBreaker = circuitManager.getBreaker('postgres', {
    failureThreshold: 3,
    timeout: 15000,
  });
  private isConnected = false;
  private openaiClient: OpenAI | null = null;
  public readonly dimensions = 1536;

  // In-memory fallback documents for offline testing and development when PostgreSQL is not running
  private fallbackStore: Map<
    string,
    { content: string; metadata?: Record<string, any>; embedding?: number[] }
  > = new Map();

  constructor() {
    this.seedFallbackStore();
    this.initPool();
  }

  private seedFallbackStore(): void {
    const initialDocs = [
      {
        id: 'doc_med_01',
        content:
          'NSAIDs (Nonsteroidal Anti-inflammatory Drugs) such as Ibuprofen and Aspirin can trigger bronchospasm in patients with Aspirin-Exacerbated Respiratory Disease (AERD) or severe asthma.',
        metadata: { category: 'pharmacology', topic: 'respiratory' },
      },
      {
        id: 'doc_med_02',
        content:
          'Acetaminophen (Paracetamol) is generally considered a safer alternative analgesic and antipyretic for patients diagnosed with reactive airway diseases.',
        metadata: { category: 'pharmacology', topic: 'analgesics' },
      },
    ];

    for (const doc of initialDocs) {
      const embedding = this.generateDeterministicEmbedding(doc.content);
      this.fallbackStore.set(doc.id, {
        content: doc.content,
        metadata: doc.metadata,
        embedding,
      });
    }
  }

  private initPool(): void {
    const connectionString =
      env.DATABASE_URL ||
      `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;

    try {
      this.pool = new Pool({
        connectionString,
        connectionTimeoutMillis: env.NODE_ENV === 'test' ? 500 : 2000,
        idleTimeoutMillis: 10000,
      });

      this.pool.on('error', (err) => {
        logger.warn(
          { err: err.message },
          'Postgres pool idle client error; switching to resilient fallback'
        );
        this.isConnected = false;
      });
    } catch (_error) {
      logger.warn('Postgres connection pool initialization deferred; operating in fallback mode');
      this.isConnected = false;
    }
  }

  /**
   * Deterministic 1536-dimensional L2-normalized pseudo-embedding generator
   * Used for offline/testing scenarios and resilient local fallback
   */
  public generateDeterministicEmbedding(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/\b[a-z0-9_-]+\b/g) || [];

    if (tokens.length === 0) {
      vector[0] = 1.0;
      return vector;
    }

    // Hash tokens into dimensions
    for (const token of tokens) {
      let hash = 2166136261;
      for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const index = Math.abs(hash) % this.dimensions;
      vector[index] += 1.0;
    }

    // L2 normalize vector
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = parseFloat((vector[i] / norm).toFixed(6));
      }
    }

    return vector;
  }

  /**
   * Generates embedding vector via configured LLM provider or deterministic fallback
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (env.OPENAI_API_KEY) {
      try {
        if (!this.openaiClient) {
          this.openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        }
        const response = await this.openaiClient.embeddings.create({
          model: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
          input: text,
        });
        if (response.data[0]?.embedding) {
          return response.data[0].embedding;
        }
      } catch (err: any) {
        logger.warn(
          { err: err.message },
          'OpenAI embedding generation failed; using deterministic fallback'
        );
      }
    }

    return this.generateDeterministicEmbedding(text);
  }

  /**
   * Initializes PostgreSQL pgvector extension, table schema, and index
   */
  async initSchema(): Promise<boolean> {
    if (!this.pool) return false;

    return this.dbBreaker.execute(async () => {
      let client;
      try {
        client = await this.pool!.connect();
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        await client.query(`
          CREATE TABLE IF NOT EXISTS document_embeddings (
            id VARCHAR(255) PRIMARY KEY,
            content TEXT NOT NULL,
            metadata JSONB DEFAULT '{}',
            embedding vector(1536)
          );
        `);
        // Create an index for vector cosine distance if not exists
        try {
          await client.query(`
            CREATE INDEX IF NOT EXISTS document_embeddings_vector_cosine_idx 
            ON document_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
          `);
        } catch (_indexErr) {
          // IVFFlat requires existing rows or can be added later; ignore if table is empty
        }
        try {
          await client.query(`
            CREATE INDEX IF NOT EXISTS document_embeddings_fts_idx 
            ON document_embeddings USING gin (to_tsvector('english', content));
          `);
        } catch (_ftsErr) {
          // GIN index fallback
        }

        this.isConnected = true;
        logger.info('PostgreSQL pgvector extension and document schema verified');
        return true;
      } catch (err: any) {
        logger.warn(
          { err: err.message },
          'PostgreSQL pgvector unavailable; running with resilient fallback'
        );
        this.isConnected = false;
        return false;
      } finally {
        if (client) client.release();
      }
    });
  }

  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Hybrid RRF (Reciprocal Rank Fusion) search combining dense pgvector embeddings
   * and sparse full-text search with resilient fallback.
   */
  async searchSimilar(
    queryText: string,
    topK: number = 3,
    queryEmbedding?: number[]
  ): Promise<VectorDocument[]> {
    if (!queryText || queryText.trim().length === 0) {
      return [];
    }

    const embedding = queryEmbedding || (await this.generateEmbedding(queryText));
    const vectorStr = `[${embedding.join(',')}]`;
    const candidateLimit = Math.max(topK * 4, 20);

    if (this.pool && this.isConnected) {
      try {
        const liveResults = await this.dbBreaker.execute(async () => {
          const client = await this.pool!.connect();
          try {
            const hybridQuery = `
              WITH dense_search AS (
                SELECT id, content, metadata,
                       ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector ASC) as rank
                FROM document_embeddings
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> $1::vector ASC
                LIMIT $2
              ),
              text_search AS (
                SELECT id, content, metadata,
                       ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $3)) DESC) as rank
                FROM document_embeddings
                WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $3)
                ORDER BY ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $3)) DESC
                LIMIT $2
              ),
              combined AS (
                SELECT 
                  COALESCE(d.id, t.id) as id,
                  COALESCE(d.content, t.content) as content,
                  COALESCE(d.metadata, t.metadata) as metadata,
                  (COALESCE(1.0 / (60.0 + d.rank), 0.0) + COALESCE(1.0 / (60.0 + t.rank), 0.0)) as rrf_score
                FROM dense_search d
                FULL OUTER JOIN text_search t ON d.id = t.id
              )
              SELECT id, content, metadata,
                     ROUND(LEAST(1.0, (rrf_score / (2.0 / 61.0)))::numeric, 4) as similarity
              FROM combined
              ORDER BY rrf_score DESC
              LIMIT $4;
            `;

            const result = await client.query(hybridQuery, [
              vectorStr,
              candidateLimit,
              queryText,
              topK,
            ]);

            if (result.rows.length > 0) {
              return result.rows.map((row) => ({
                id: row.id,
                content: row.content,
                metadata: row.metadata,
                similarity: parseFloat(row.similarity),
              }));
            }
            return [];
          } finally {
            client.release();
          }
        });

        if (liveResults && liveResults.length > 0) {
          return liveResults;
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Live hybrid vector query failed; using fallback store');
      }
    }

    // Resilient fallback scoring using RRF over in-memory cosine similarities and keyword token matching
    const fallbackDocs = Array.from(this.fallbackStore.entries()).map(([id, doc]) => {
      let cosineSim = 0;
      if (doc.embedding && doc.embedding.length === embedding.length) {
        let dotProduct = 0;
        for (let i = 0; i < embedding.length; i++) {
          dotProduct += embedding[i] * doc.embedding[i];
        }
        cosineSim = Math.max(0, dotProduct);
      }

      const queryTokens = queryText
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2);
      const docLower = doc.content.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (docLower.includes(token)) {
          matchCount++;
        }
      }
      const tokenScore = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;

      return {
        id,
        content: doc.content,
        metadata: doc.metadata,
        cosineSim,
        tokenScore,
      };
    });

    // Rank dense
    const denseSorted = [...fallbackDocs].sort((a, b) => b.cosineSim - a.cosineSim);
    const denseRankMap = new Map<string, number>();
    denseSorted.forEach((d, idx) => denseRankMap.set(d.id, idx + 1));

    // Rank keyword / sparse
    const textSorted = [...fallbackDocs]
      .filter((d) => d.tokenScore > 0)
      .sort((a, b) => b.tokenScore - a.tokenScore);
    const textRankMap = new Map<string, number>();
    textSorted.forEach((d, idx) => textRankMap.set(d.id, idx + 1));

    const k = 60;
    const maxRRF = 2 / (k + 1);
    const results: VectorDocument[] = fallbackDocs.map((doc) => {
      const denseRank = denseRankMap.get(doc.id);
      const textRank = textRankMap.get(doc.id);

      const rrfScore =
        (denseRank ? 1 / (k + denseRank) : 0) +
        (textRank ? 1 / (k + textRank) : 0);

      const normalizedScore = Number(Math.min(1.0, rrfScore / maxRRF).toFixed(4));

      return {
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        similarity: normalizedScore,
      };
    });

    results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    return results.slice(0, topK);
  }

  /**
   * Upsert a document into vector storage
   */
  async upsertDocument(
    id: string,
    content: string,
    embedding?: number[],
    metadata?: Record<string, any>
  ): Promise<void> {
    const docEmbedding = embedding || (await this.generateEmbedding(content));
    this.fallbackStore.set(id, { content, metadata, embedding: docEmbedding });

    if (this.pool && this.isConnected) {
      try {
        await this.dbBreaker.execute(async () => {
          const client = await this.pool!.connect();
          try {
            const vectorStr = `[${docEmbedding.join(',')}]`;
            await client.query(
              `INSERT INTO document_embeddings (id, content, metadata, embedding)
               VALUES ($1, $2, $3, $4::vector)
               ON CONFLICT (id) DO UPDATE 
               SET content = EXCLUDED.content, 
                   metadata = EXCLUDED.metadata,
                   embedding = EXCLUDED.embedding`,
              [id, content, JSON.stringify(metadata || {}), vectorStr]
            );
          } finally {
            client.release();
          }
        });
      } catch (err: any) {
        logger.warn(
          { err: err.message },
          'Failed to persist document to postgres; cached in fallback store'
        );
      }
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch (err: any) {
        logger.debug({ err: err.message }, 'Error closing Postgres pool');
      } finally {
        this.pool = null;
        this.isConnected = false;
      }
    }
  }
}

export const vectorService = new VectorService();
