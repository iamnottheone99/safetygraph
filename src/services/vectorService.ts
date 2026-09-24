import { Pool } from 'pg';
import pino from 'pino';
import OpenAI from 'openai';
import { circuitManager } from '../utils/circuitBreaker';

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
  private dbBreaker = circuitManager.getBreaker('postgres', { failureThreshold: 3, timeout: 15000 });
  private isConnected = false;
  private openaiClient: OpenAI | null = null;
  public readonly dimensions = 1536;
  
  // In-memory fallback documents for offline testing and development when PostgreSQL is not running
  private fallbackStore: Map<string, { content: string; metadata?: Record<string, any>; embedding?: number[] }> = new Map();

  constructor() {
    this.seedFallbackStore();
    this.initPool();
  }

  private seedFallbackStore(): void {
    const initialDocs = [
      {
        id: 'doc_med_01',
        content: 'NSAIDs (Nonsteroidal Anti-inflammatory Drugs) such as Ibuprofen and Aspirin can trigger bronchospasm in patients with Aspirin-Exacerbated Respiratory Disease (AERD) or severe asthma.',
        metadata: { category: 'pharmacology', topic: 'respiratory' }
      },
      {
        id: 'doc_med_02',
        content: 'Acetaminophen (Paracetamol) is generally considered a safer alternative analgesic and antipyretic for patients diagnosed with reactive airway diseases.',
        metadata: { category: 'pharmacology', topic: 'analgesics' }
      }
    ];

    for (const doc of initialDocs) {
      const embedding = this.generateDeterministicEmbedding(doc.content);
      this.fallbackStore.set(doc.id, {
        content: doc.content,
        metadata: doc.metadata,
        embedding
      });
    }
  }

  private initPool(): void {
    const connectionString = process.env.DATABASE_URL || 
      `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'password'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'safetygraph'}`;

    try {
      this.pool = new Pool({
        connectionString,
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 10000,
      });

      this.pool.on('error', (err) => {
        logger.warn({ err: err.message }, 'Postgres pool idle client error; switching to resilient fallback');
        this.isConnected = false;
      });
    } catch (error) {
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
    if (process.env.OPENAI_API_KEY) {
      try {
        if (!this.openaiClient) {
          this.openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        }
        const response = await this.openaiClient.embeddings.create({
          model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
          input: text,
        });
        if (response.data[0]?.embedding) {
          return response.data[0].embedding;
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'OpenAI embedding generation failed; using deterministic fallback');
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
        } catch (indexErr) {
          // IVFFlat requires existing rows or can be added later; ignore if table is empty
        }

        this.isConnected = true;
        logger.info('PostgreSQL pgvector extension and document schema verified');
        return true;
      } catch (err: any) {
        logger.warn({ err: err.message }, 'PostgreSQL pgvector unavailable; running with resilient fallback');
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
   * Semantic vector search query using pgvector cosine distance with fallback for offline environments
   */
  async searchSimilar(queryText: string, topK: number = 3, queryEmbedding?: number[]): Promise<VectorDocument[]> {
    if (!queryText || queryText.trim().length === 0) {
      return [];
    }

    const embedding = queryEmbedding || await this.generateEmbedding(queryText);
    const vectorStr = `[${embedding.join(',')}]`;

    if (this.pool && this.isConnected) {
      try {
        return await this.dbBreaker.execute(async () => {
          const client = await this.pool!.connect();
          try {
            // True pgvector cosine distance search
            const result = await client.query(
              `SELECT id, content, metadata,
                      ROUND((1 - (embedding <=> $1::vector))::numeric, 4) as similarity
               FROM document_embeddings 
               WHERE embedding IS NOT NULL
               ORDER BY embedding <=> $1::vector ASC
               LIMIT $2`,
              [vectorStr, topK]
            );

            if (result.rows.length > 0) {
              return result.rows.map(row => ({
                id: row.id,
                content: row.content,
                metadata: row.metadata,
                similarity: parseFloat(row.similarity)
              }));
            }

            // Fallback to full-text search if no rows with embeddings are populated yet
            const ftsResult = await client.query(
              `SELECT id, content, metadata FROM document_embeddings 
               WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
               LIMIT $2`,
              [queryText, topK]
            );
            return ftsResult.rows.map(row => ({
              id: row.id,
              content: row.content,
              metadata: row.metadata,
              similarity: 0.9
            }));
          } finally {
            client.release();
          }
        });
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Live vector query failed; using fallback store');
      }
    }

    // Resilient fallback scoring using cosine similarity over in-memory vectors & keyword overlap
    const results: VectorDocument[] = [];

    for (const [id, doc] of this.fallbackStore.entries()) {
      let sim = 0;
      if (doc.embedding && doc.embedding.length === embedding.length) {
        let dotProduct = 0;
        for (let i = 0; i < embedding.length; i++) {
          dotProduct += embedding[i] * doc.embedding[i];
        }
        sim = Math.max(0, dotProduct);
      }

      // Keyword token fallback bonus
      const queryTokens = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 2);
      const docLower = doc.content.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (docLower.includes(token)) {
          matchCount++;
        }
      }
      const tokenScore = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
      const finalScore = Number(Math.max(sim, tokenScore, 0.5).toFixed(2));

      results.push({
        id,
        content: doc.content,
        metadata: doc.metadata,
        similarity: finalScore,
      });
    }

    results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    return results.slice(0, topK);
  }

  /**
   * Upsert a document into vector storage
   */
  async upsertDocument(id: string, content: string, embedding?: number[], metadata?: Record<string, any>): Promise<void> {
    const docEmbedding = embedding || await this.generateEmbedding(content);
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
        logger.warn({ err: err.message }, 'Failed to persist document to postgres; cached in fallback store');
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
