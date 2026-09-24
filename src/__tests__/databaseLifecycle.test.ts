import { VectorService } from '../services/vectorService';
import { GraphContextService } from '../services/graphContextService';
import request from 'supertest';
import app from '../app';

describe('Phase 1: Database & Lifecycle Verification', () => {
  let vectorService: VectorService;
  let graphContextService: GraphContextService;

  beforeEach(() => {
    vectorService = new VectorService();
    graphContextService = new GraphContextService();
  });

  afterEach(async () => {
    await vectorService.close();
    await graphContextService.close();
  });

  describe('VectorService Embedding & Search Pipeline', () => {
    test('should generate deterministic 1536-dimensional normalized embeddings', async () => {
      const embedding = await vectorService.generateEmbedding('Asthma and bronchospasm');
      expect(embedding).toHaveLength(1536);
      
      // Check normalization (length should be approximately 1.0)
      let norm = 0;
      for (const val of embedding) {
        norm += val * val;
      }
      expect(Math.sqrt(norm)).toBeCloseTo(1.0, 2);
    });

    test('should produce identical embeddings for identical texts', async () => {
      const text = 'Deterministic clinical safety prompt';
      const emb1 = await vectorService.generateEmbedding(text);
      const emb2 = await vectorService.generateEmbedding(text);
      expect(emb1).toEqual(emb2);
    });

    test('should perform semantic search and sort by similarity', async () => {
      const results = await vectorService.searchSimilar('severe asthma and respiratory illness', 2);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('content');
      expect(results[0]).toHaveProperty('similarity');
      expect(results[0].similarity).toBeGreaterThan(0);
    });

    test('should support upserting documents into fallback store', async () => {
      await vectorService.upsertDocument('doc_custom_test', 'Custom clinical protocol for hypertension', undefined, { category: 'cardiology' });
      const results = await vectorService.searchSimilar('hypertension protocol', 1);
      expect(results[0].id).toBe('doc_custom_test');
    });

    test('should handle initSchema gracefully when PostgreSQL is offline', async () => {
      const schemaReady = await vectorService.initSchema();
      // When local PostgreSQL container is not running, it must safely return false and remain in fallback
      expect(typeof schemaReady).toBe('boolean');
      expect(vectorService.isReady()).toBe(schemaReady);
    });
  });

  describe('GraphContextService Connectivity & Fallbacks', () => {
    test('should verify connectivity and report offline status gracefully without crashing', async () => {
      const isConnected = await graphContextService.verifyConnectivity();
      expect(typeof isConnected).toBe('boolean');
      expect(graphContextService.isReady()).toBe(isConnected);
    });

    test('should retrieve registered constraints from fallback store', async () => {
      graphContextService.registerConstraint('test_drug', 'Contraindicated in cardiac failure');
      const constraints = await graphContextService.getHardConstraints(['test_drug']);
      expect(constraints).toContain('Contraindicated in cardiac failure');
    });
  });

  describe('Health Check Subsystem Reporting', () => {
    test('should return database readiness details in /health endpoint', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('databases');
      expect(res.body.databases).toHaveProperty('postgres');
      expect(res.body.databases).toHaveProperty('neo4j');
      expect(typeof res.body.databases.postgres).toBe('boolean');
      expect(typeof res.body.databases.neo4j).toBe('boolean');
    });
  });
});
